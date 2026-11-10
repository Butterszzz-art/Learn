// Builds one page of a person's feed (Phase 14) and records what they do
// with it. Everything served here already exists in the shared pool — a
// feed request never waits on an AI call.
import { client } from "@/db";
import type { CardType, Level } from "@/db/schema";
import { LEVELS } from "@/db/schema";
import type { CurrentUser } from "./auth";
import { getEnabledInterests } from "./interests";
import type { InterestWithConfig } from "./interests";
import { assemblePage, computeAffinities, scoreCandidate, levelDistance, DEFAULT_ASSEMBLE } from "./rank";
import type { Candidate, RankContext } from "./rank";
import type { CardEvent, FeedCard } from "./cardTypes";
import { getDueConcepts, gradeConcept, markConceptSeen } from "./learning";
import { planWork } from "./engine/scheduler";

const PER_SERIES_LIMIT = 30; // unseen deep-dive cards considered per (interest, level)
const PER_INTEREST_OTHER_LIMIT = 25; // unseen news / fact cards considered per interest
const REVIEW_EVERY = 5;
const MAX_REVIEWS_PER_PAGE = 2;
const LOW_WATER = 12; // fewer unseen candidates than this triggers a top-up

interface CardRow extends Candidate {
  title: string;
  body: string;
  payload: string;
  itemId: number | null;
}

function toCandidate(r: any): CardRow {
  return {
    id: Number(r.id),
    type: r.type as CardType,
    interestId: r.interest_id === null ? null : Number(r.interest_id),
    level: (r.level as Level | null) ?? null,
    conceptId: r.concept_id === null ? null : Number(r.concept_id),
    deepDiveId: r.deep_dive_id === null ? null : Number(r.deep_dive_id),
    seq: Number(r.seq ?? 0),
    diveSeq: r.dive_seq === null || r.dive_seq === undefined ? null : Number(r.dive_seq),
    createdAt: r.created_at,
    title: r.title,
    body: r.body,
    payload: r.payload,
    itemId: r.item_id === null ? null : Number(r.item_id),
  };
}

const CARD_COLUMNS = "c.id, c.type, c.interest_id, c.level, c.concept_id, c.deep_dive_id, c.item_id, c.seq, c.title, c.body, c.payload, c.created_at";

function marks(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

/** Unseen deep-dive cards, the first few entries of each series the reader follows. */
async function loadSeriesCards(userId: number, interests: InterestWithConfig[], exclude: number[]): Promise<CardRow[]> {
  if (interests.length === 0) return [];
  const ids = interests.map((i) => i.id);
  const res = await client.execute({
    sql: `SELECT * FROM (
            SELECT ${CARD_COLUMNS}, d.seq AS dive_seq_raw,
                   ROW_NUMBER() OVER (PARTITION BY c.interest_id, c.level ORDER BY COALESCE(d.seq, 100000), d.id, c.seq) AS rn
            FROM cards c JOIN deep_dives d ON d.id = c.deep_dive_id
            WHERE c.status = 'published' AND d.status = 'published' AND c.interest_id IN (${marks(ids.length)})
              AND NOT EXISTS (SELECT 1 FROM user_cards uc WHERE uc.user_id = ? AND uc.card_id = c.id)
              ${exclude.length ? `AND c.id NOT IN (${marks(exclude.length)})` : ""}
          ) WHERE rn <= ?`,
    args: [...ids, userId, ...exclude, PER_SERIES_LIMIT],
  });
  const rows = (res.rows as any[]).map((r) => ({ ...toCandidate(r), diveSeqRaw: r.dive_seq_raw as number | null }));

  // Per interest, keep the reader's own level; if that series is empty,
  // fall back to the nearest level that has something.
  const out: CardRow[] = [];
  for (const interest of interests) {
    const mine = rows.filter((r) => r.interestId === interest.id && r.level !== null);
    if (mine.length === 0) continue;
    const allowed: readonly Level[] = interest.level === "research_level" ? LEVELS : LEVELS.filter((l) => l !== "research_level");
    const available = [...new Set(mine.map((r) => r.level as Level))].filter((l) => allowed.includes(l) || l === interest.level);
    if (available.length === 0) continue;
    const best = available.sort((a, b) => levelDistance(a, interest.level) - levelDistance(b, interest.level))[0];
    const series = mine.filter((r) => r.level === best);
    // Position among the reader's unread entries (1 = read this next).
    const order = [...new Set(series.map((r) => r.deepDiveId))];
    for (const r of series) out.push({ ...r, diveSeq: order.indexOf(r.deepDiveId) + 1 });
  }
  // Level-less cards that hang off a deep dive (none today, but harmless).
  return out;
}

/** Unseen cards that aren't part of a series: news, counterarguments, facts, logic drills. */
async function loadOtherCards(userId: number, interestIds: number[], exclude: number[]): Promise<CardRow[]> {
  if (interestIds.length === 0) return [];
  const res = await client.execute({
    sql: `SELECT * FROM (
            SELECT ${CARD_COLUMNS}, NULL AS dive_seq,
                   ROW_NUMBER() OVER (PARTITION BY c.interest_id ORDER BY c.created_at DESC, c.id DESC) AS rn
            FROM cards c
            WHERE c.status = 'published' AND c.deep_dive_id IS NULL AND c.interest_id IN (${marks(interestIds.length)})
              AND NOT EXISTS (SELECT 1 FROM user_cards uc WHERE uc.user_id = ? AND uc.card_id = c.id)
              ${exclude.length ? `AND c.id NOT IN (${marks(exclude.length)})` : ""}
          ) WHERE rn <= ?`,
    args: [...interestIds, userId, ...exclude, PER_INTEREST_OTHER_LIMIT],
  });
  return (res.rows as any[]).map(toCandidate);
}

/** Interest-less cards: mental models, and brain games if opted in. */
async function loadGeneralCards(userId: number, includeGames: boolean, exclude: number[]): Promise<CardRow[]> {
  const types = includeGames ? ["model", "game"] : ["model"];
  const res = await client.execute({
    sql: `SELECT ${CARD_COLUMNS}, NULL AS dive_seq FROM cards c
          WHERE c.status = 'published' AND c.interest_id IS NULL AND c.type IN (${marks(types.length)})
            AND NOT EXISTS (SELECT 1 FROM user_cards uc WHERE uc.user_id = ? AND uc.card_id = c.id)
            ${exclude.length ? `AND c.id NOT IN (${marks(exclude.length)})` : ""}
          ORDER BY RANDOM() LIMIT 4`,
    args: [...types, userId, ...exclude],
  });
  return (res.rows as any[]).map(toCandidate);
}

/** A trickle of cards from fields the reader doesn't follow. */
async function loadExploreCards(userId: number, followedIds: number[], exclude: number[]): Promise<CardRow[]> {
  const res = await client.execute({
    sql: `SELECT ${CARD_COLUMNS}, NULL AS dive_seq FROM cards c
          JOIN interests i ON i.id = c.interest_id
          WHERE c.status = 'published' AND i.is_library_book = 0 AND i.is_custom = 0
            AND c.type IN ('bite','paper','myth','fact') AND c.seq = 0
            ${followedIds.length ? `AND c.interest_id NOT IN (${marks(followedIds.length)})` : ""}
            AND (c.level IS NULL OR c.level IN ('new_to_this','some_background'))
            AND NOT EXISTS (SELECT 1 FROM user_cards uc WHERE uc.user_id = ? AND uc.card_id = c.id)
            ${exclude.length ? `AND c.id NOT IN (${marks(exclude.length)})` : ""}
          ORDER BY RANDOM() LIMIT 12`,
    args: [...followedIds, userId, ...exclude],
  });
  return (res.rows as any[]).map(toCandidate);
}

async function loadRankContext(userId: number, interests: InterestWithConfig[], conceptIds: number[]): Promise<RankContext> {
  const behaviour = await client.execute({
    sql: `SELECT interest_id, card_type, completed, expanded, saved, skipped_fast, answered_correct
          FROM user_cards WHERE user_id = ? ORDER BY seen_at DESC LIMIT 300`,
    args: [userId],
  });
  const { interestAffinity, typeAffinity } = computeAffinities(
    (behaviour.rows as any[]).map((r) => ({
      interestId: r.interest_id === null ? null : Number(r.interest_id),
      cardType: r.card_type,
      completed: !!r.completed,
      expanded: !!r.expanded,
      saved: !!r.saved,
      skippedFast: !!r.skipped_fast,
      answeredCorrect: r.answered_correct === null ? null : !!r.answered_correct,
    }))
  );
  const knownRes = await client.execute({ sql: "SELECT concept_id FROM user_concepts WHERE user_id = ?", args: [userId] });
  const prereqs = new Map<number, number[]>();
  if (conceptIds.length > 0) {
    const edgeRes = await client.execute({
      sql: `SELECT from_concept_id, to_concept_id FROM concept_edges WHERE kind = 'prereq' AND to_concept_id IN (${marks(conceptIds.length)})`,
      args: conceptIds,
    });
    for (const e of edgeRes.rows as any[]) {
      const to = Number(e.to_concept_id);
      prereqs.set(to, [...(prereqs.get(to) ?? []), Number(e.from_concept_id)]);
    }
  }
  const now = Date.now();
  return {
    now,
    daySeed: Math.floor(now / 86400000) + userId * 7919,
    interests: new Map(interests.map((i) => [i.id, { level: i.level, isFavorite: i.isFavorite }])),
    interestAffinity,
    typeAffinity,
    knownConcepts: new Set((knownRes.rows as any[]).map((r) => Number(r.concept_id))),
    prereqs,
  };
}

function parsePayload(raw: string): Record<string, any> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const AI_WRITTEN: CardType[] = ["bite", "quiz", "debate", "insight", "visual", "myth", "paper"];

/** Adds the display fields a card needs (interest, concept and deep-dive names). */
async function hydrate(rows: { card: CardRow; explore: boolean }[], userId: number): Promise<FeedCard[]> {
  if (rows.length === 0) return [];
  const interestIds = [...new Set(rows.map((r) => r.card.interestId).filter((x): x is number => x !== null))];
  const conceptIds = [...new Set(rows.map((r) => r.card.conceptId).filter((x): x is number => x !== null))];
  const diveIds = [...new Set(rows.map((r) => r.card.deepDiveId).filter((x): x is number => x !== null))];
  const cardIds = rows.map((r) => r.card.id);
  const nameMap = async (table: string, col: string, ids: number[]) => {
    const m = new Map<number, string>();
    if (ids.length === 0) return m;
    const res = await client.execute({ sql: `SELECT id, ${col} AS v FROM ${table} WHERE id IN (${marks(ids.length)})`, args: ids });
    for (const r of res.rows as any[]) m.set(Number(r.id), r.v);
    return m;
  };
  const [interestNames, conceptNames, diveTopics, savedRes] = await Promise.all([
    nameMap("interests", "name", interestIds),
    nameMap("concepts", "name", conceptIds),
    nameMap("deep_dives", "topic", diveIds),
    client.execute({
      sql: `SELECT card_id FROM user_cards WHERE user_id = ? AND saved = 1 AND card_id IN (${marks(cardIds.length)})`,
      args: [userId, ...cardIds],
    }),
  ]);
  const saved = new Set((savedRes.rows as any[]).map((r) => Number(r.card_id)));
  return rows.map(({ card: c, explore }) => ({
    key: `c${c.id}`,
    kind: c.type,
    cardId: c.id,
    interestId: c.interestId,
    interestName: c.interestId !== null ? interestNames.get(c.interestId) ?? null : null,
    level: c.level,
    title: c.title,
    body: c.body,
    payload: parsePayload(c.payload),
    conceptId: c.conceptId,
    conceptName: c.conceptId !== null ? conceptNames.get(c.conceptId) ?? null : null,
    deepDiveId: c.deepDiveId,
    deepDiveTopic: c.deepDiveId !== null ? diveTopics.get(c.deepDiveId) ?? null : null,
    explore,
    saved: saved.has(c.id),
    aiGenerated: AI_WRITTEN.includes(c.type),
  }));
}

/** Due reviews as feed cards: a quiz on the concept if one exists, else a recall prompt. */
export async function buildReviewCards(userId: number, limit: number, excludeKeys: Set<string>): Promise<FeedCard[]> {
  const due = (await getDueConcepts(userId, limit + excludeKeys.size)).filter((d) => !excludeKeys.has(`review-${d.conceptId}`));
  const out: FeedCard[] = [];
  for (const d of due.slice(0, limit)) {
    const quizRes = await client.execute({
      sql: `SELECT c.id, c.body, c.payload FROM cards c
            LEFT JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ?
            WHERE c.concept_id = ? AND c.type = 'quiz' AND c.status = 'published'
            ORDER BY (uc.card_id IS NOT NULL), RANDOM() LIMIT 1`,
      args: [userId, d.conceptId],
    });
    const q = quizRes.rows[0] as any;
    out.push({
      key: `review-${d.conceptId}`,
      kind: "review",
      cardId: q ? Number(q.id) : null,
      interestId: d.interestId,
      interestName: d.interestName.replace(/^Library: /, ""),
      level: null,
      title: d.name,
      body: d.definition,
      payload: q ? { quiz: { ...parsePayload(q.payload), question: q.body } } : {},
      conceptId: d.conceptId,
      conceptName: d.name,
      deepDiveId: d.deepDiveId,
      deepDiveTopic: null,
      explore: false,
      saved: false,
      aiGenerated: true,
    });
  }
  return out;
}

/** The next Library chapter, released at the pace the reader set — at most one pointer a day per book. */
async function buildChapterCard(userId: number): Promise<FeedCard | null> {
  const res = await client.execute({
    sql: `SELECT ch.id, ch.title, ch.chapter_number, ch.summary, b.title AS book_title, b.id AS book_id
          FROM book_chapters ch JOIN books b ON b.id = ch.book_id
          WHERE b.user_id = ? AND ch.summary IS NOT NULL AND ch.status = 'pending'
            AND (SELECT COUNT(*) FROM book_chapters x WHERE x.book_id = b.id AND x.surfaced_at >= date('now')) < b.pace_chapters_per_cycle
          ORDER BY ch.book_id, ch.chapter_number LIMIT 1`,
    args: [userId],
  });
  const r = res.rows[0] as any;
  if (!r) return null;
  const summary = String(r.summary);
  return {
    key: `chapter-${r.id}`,
    kind: "chapter",
    cardId: null,
    interestId: null,
    interestName: r.book_title,
    level: null,
    title: `Chapter ${r.chapter_number}: ${r.title}`,
    body: summary.length > 320 ? summary.slice(0, 320).replace(/\s+\S*$/, "") + "…" : summary,
    payload: { chapterId: Number(r.id), bookId: Number(r.book_id) },
    conceptId: null,
    conceptName: null,
    deepDiveId: null,
    deepDiveTopic: null,
    explore: false,
    saved: false,
    aiGenerated: true,
  };
}

function synthetic(kind: "brewing" | "caughtup", title: string, body: string): FeedCard {
  return {
    key: `${kind}-${Date.now()}`,
    kind,
    cardId: null,
    interestId: null,
    interestName: null,
    level: null,
    title,
    body,
    payload: {},
    conceptId: null,
    conceptName: null,
    deepDiveId: null,
    deepDiveTopic: null,
    explore: false,
    saved: false,
    aiGenerated: false,
  };
}

export interface FeedPage {
  cards: FeedCard[];
  hasMore: boolean;
  brewing: boolean;
}

export interface FeedRequest {
  exclude?: number[]; // card ids already on the client
  excludeKeys?: string[]; // synthetic keys already on the client
  count?: number;
  interestId?: number; // optional temporary filter
}

export async function getFeedPage(user: CurrentUser, req: FeedRequest = {}): Promise<FeedPage> {
  const count = Math.min(Math.max(req.count ?? DEFAULT_ASSEMBLE.count, 1), 20);
  const exclude = (req.exclude ?? []).filter((n) => Number.isInteger(n)).slice(-400);
  const excludeKeys = new Set(req.excludeKeys ?? []);
  const firstPage = exclude.length === 0;

  let interests = await getEnabledInterests(user.id);
  if (req.interestId) interests = interests.filter((i) => i.id === req.interestId);
  const interestIds = interests.map((i) => i.id);

  const [series, other, general, exploreRows] = await Promise.all([
    loadSeriesCards(user.id, interests, exclude),
    loadOtherCards(user.id, interestIds, exclude),
    req.interestId ? Promise.resolve([]) : loadGeneralCards(user.id, !!user.prefs.includeBrainGames, exclude),
    req.interestId ? Promise.resolve([]) : loadExploreCards(user.id, interestIds, exclude),
  ]);
  const main = [...series, ...other, ...general];
  const conceptIds = [...new Set(main.map((c) => c.conceptId).filter((x): x is number => x !== null))];
  const ctx = await loadRankContext(user.id, interests, conceptIds);

  // Deep dives the reader has already been introduced to (so their quizzes may show).
  const diveIds = [...new Set(main.map((c) => c.deepDiveId).filter((x): x is number => x !== null))];
  const introduced = new Set<number>();
  if (diveIds.length > 0) {
    const res = await client.execute({
      sql: `SELECT DISTINCT c.deep_dive_id AS id FROM cards c
            WHERE c.deep_dive_id IN (${marks(diveIds.length)}) AND c.type != 'quiz'
              AND (EXISTS (SELECT 1 FROM user_cards uc WHERE uc.user_id = ? AND uc.card_id = c.id)
                   ${exclude.length ? `OR c.id IN (${marks(exclude.length)})` : ""})`,
      args: [...diveIds, user.id, ...exclude],
    });
    for (const r of res.rows as any[]) introduced.add(Number(r.id));
  }

  const page = assemblePage(
    main.map((card) => ({ card, score: scoreCandidate(card, ctx) })),
    exploreRows.map((card) => ({ card, score: scoreCandidate(card, ctx, true) })),
    { ...DEFAULT_ASSEMBLE, count, introducedDives: introduced }
  );
  const cards = await hydrate(page, user.id);

  // Weave due reviews in, one every few cards.
  if (!req.interestId) {
    const reviews = await buildReviewCards(user.id, MAX_REVIEWS_PER_PAGE, excludeKeys);
    reviews.forEach((r, i) => {
      const at = Math.min(cards.length, (i + 1) * REVIEW_EVERY - 1 + i);
      cards.splice(at, 0, r);
    });
    if (firstPage) {
      const chapter = await buildChapterCard(user.id);
      if (chapter && !excludeKeys.has(chapter.key)) cards.splice(Math.min(2, cards.length), 0, chapter);
    }
  }

  // Running low on unseen material: ask the scheduler to top up this
  // reader's series. Deduplicated, so calling it on every page is cheap.
  let brewing = false;
  if (main.length < LOW_WATER && !req.interestId) {
    const planned = await planWork(user.id).catch(() => null);
    const pending = await client.execute("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running') AND type IN ('series_next','news','expand')");
    brewing = (planned?.series ?? 0) > 0 || Number((pending.rows[0] as any)?.n ?? 0) > 0;
  }

  const hasMore = main.length > page.filter((p) => !p.explore).length || exploreRows.length > page.filter((p) => p.explore).length;
  if (!hasMore) {
    if (brewing && !excludeKeys.has("brewing")) {
      cards.push({
        ...synthetic("brewing", "More is on its way", "New entries for your interests are being researched and written right now. They usually land within a few minutes."),
        key: "brewing",
      });
    } else if (cards.length === 0 || !brewing) {
      if (!excludeKeys.has("caughtup")) {
        cards.push({
          ...synthetic("caughtup", "You're all caught up", interests.length === 0 ? "Pick some interests to start your feed." : "You've seen everything ready for you. New material arrives through the day."),
          key: "caughtup",
        });
      }
    }
  }
  return { cards, hasMore: hasMore || brewing, brewing };
}

/** One card by id, for share links and search results. */
export async function getCardById(cardId: number, userId: number): Promise<FeedCard | null> {
  const res = await client.execute({
    sql: `SELECT ${CARD_COLUMNS}, NULL AS dive_seq FROM cards c WHERE c.id = ? AND c.status = 'published'`,
    args: [cardId],
  });
  if (!res.rows[0]) return null;
  return (await hydrate([{ card: toCandidate(res.rows[0]), explore: false }], userId))[0] ?? null;
}

export async function getSavedCards(userId: number, limit = 100): Promise<FeedCard[]> {
  const res = await client.execute({
    sql: `SELECT ${CARD_COLUMNS}, NULL AS dive_seq FROM cards c JOIN user_cards uc ON uc.card_id = c.id
          WHERE uc.user_id = ? AND uc.saved = 1 AND c.status = 'published' ORDER BY uc.seen_at DESC LIMIT ?`,
    args: [userId, limit],
  });
  return hydrate((res.rows as any[]).map((r) => ({ card: toCandidate(r), explore: false })), userId);
}

const FAST_SKIP_MS = 1200;
const COMPLETED_MS = 3500;

/**
 * Applies a batch of client-reported card events. Each event upserts the
 * (person, card) row; quiz answers also update the concept's schedule.
 */
export async function recordEvents(userId: number, events: CardEvent[]): Promise<void> {
  const ids = [...new Set(events.map((e) => e.cardId).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 60);
  if (ids.length === 0) return;
  const cardRes = await client.execute({
    sql: `SELECT id, type, interest_id, concept_id FROM cards WHERE id IN (${marks(ids.length)})`,
    args: ids,
  });
  const cardInfo = new Map<number, { type: string; interestId: number | null; conceptId: number | null }>();
  for (const r of cardRes.rows as any[]) {
    cardInfo.set(Number(r.id), {
      type: r.type,
      interestId: r.interest_id === null ? null : Number(r.interest_id),
      conceptId: r.concept_id === null ? null : Number(r.concept_id),
    });
  }
  const now = new Date().toISOString();

  for (const e of events.slice(0, 200)) {
    const info = cardInfo.get(e.cardId);
    if (!info) continue;
    await client.execute({
      sql: `INSERT OR IGNORE INTO user_cards (user_id, card_id, interest_id, card_type, seen_at) VALUES (?, ?, ?, ?, ?)`,
      args: [userId, e.cardId, info.interestId, info.type, now],
    });
    const set = async (sql: string, args: (number | string)[] = []) =>
      client.execute({ sql: `UPDATE user_cards SET ${sql} WHERE user_id = ? AND card_id = ?`, args: [...args, userId, e.cardId] });

    switch (e.event) {
      case "impression":
        break;
      case "dwell": {
        const ms = Math.max(0, Math.min(Number(e.value) || 0, 10 * 60000));
        await set("dwell_ms = dwell_ms + ?", [ms]);
        if (ms < FAST_SKIP_MS) await set("skipped_fast = CASE WHEN completed = 1 THEN 0 ELSE 1 END");
        if (ms >= COMPLETED_MS) {
          await set("completed = 1, skipped_fast = 0");
          if (info.conceptId && info.type !== "quiz") await markConceptSeen(userId, info.conceptId);
        }
        break;
      }
      case "completed":
        await set("completed = 1, skipped_fast = 0");
        if (info.conceptId && info.type !== "quiz") await markConceptSeen(userId, info.conceptId);
        break;
      case "skipped_fast":
        await set("skipped_fast = CASE WHEN completed = 1 THEN 0 ELSE 1 END");
        break;
      case "expanded":
      case "go_deeper":
        await set("expanded = 1, completed = 1, skipped_fast = 0");
        break;
      case "saved":
        await set("saved = 1");
        break;
      case "unsaved":
        await set("saved = 0");
        break;
      case "shared":
        await set("shared = 1");
        break;
      case "quiz_correct":
      case "quiz_incorrect": {
        const correct = e.event === "quiz_correct";
        await set("answered_correct = ?, completed = 1, skipped_fast = 0", [correct ? 1 : 0]);
        if (info.conceptId) await gradeConcept(userId, info.conceptId, correct ? "good" : "again");
        break;
      }
    }
  }
}

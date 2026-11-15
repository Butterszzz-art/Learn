// One-time content setup that needs no AI calls: turns the curated banks
// (brain facts, mental models, brain games) and any pre-launch news and
// drills into feed cards, and rebuilds the search index after its schema
// changed. Each step is guarded by a schema_meta flag so it runs once.
import { client } from "@/db";
import { getMeta, setMeta } from "@/db/migrateV2";
import { upsertCard, upsertConcept } from "./cards";
import { paperCardForItem, firstSentence } from "./news";
import { DRILL_TYPE_LABELS } from "@/db/schema";
import type { DrillType } from "@/db/schema";
import type { QuizPayload, DebatePayload, GamePayload, ModelPayload } from "../cardTypes";

const STATIC_VERSION = "1";
const LEGACY_ITEM_LIMIT = 400;

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

async function seedStaticCards(): Promise<void> {
  const counts = await client.execute(
    "SELECT (SELECT COUNT(*) FROM brain_facts) AS f, (SELECT COUNT(*) FROM mental_models) AS m, (SELECT COUNT(*) FROM brain_games) AS g"
  );
  const c = counts.rows[0] as any;
  const signature = `${STATIC_VERSION}:${c.f}:${c.m}:${c.g}`;
  if ((await getMeta(client, "static_cards")) === signature) return;

  const neuro = await client.execute("SELECT id FROM interests WHERE slug = 'neuroscience'");
  const neuroId = neuro.rows[0] ? Number((neuro.rows[0] as any).id) : null;

  const facts = await client.execute("SELECT id, text, topic FROM brain_facts");
  for (const f of facts.rows as any[]) {
    await upsertCard({
      type: "fact",
      interestId: neuroId,
      level: null,
      title: f.topic ? titleCase(String(f.topic).replace(/_/g, " ")) : "Brain fact",
      body: f.text,
      dedupeKey: `fact:${f.id}`,
    });
  }
  const models = await client.execute("SELECT id, name, category, description FROM mental_models");
  for (const m of models.rows as any[]) {
    const payload: ModelPayload = { category: m.category };
    await upsertCard({
      type: "model",
      interestId: null,
      level: null,
      title: m.name,
      body: m.description,
      payload: payload as unknown as Record<string, unknown>,
      dedupeKey: `model:${m.id}`,
    });
  }
  const games = await client.execute("SELECT id, game_type, content, answer FROM brain_games");
  for (const g of games.rows as any[]) {
    const payload: GamePayload = { answer: g.answer, gameType: g.game_type };
    await upsertCard({
      type: "game",
      interestId: null,
      level: null,
      title: titleCase(String(g.game_type).replace(/_/g, " ")),
      body: g.content,
      payload: payload as unknown as Record<string, unknown>,
      dedupeKey: `game:${g.id}`,
    });
  }
  await setMeta(client, "static_cards", signature);
}

/** Pre-launch news items, counterarguments and drills become cards. */
async function backfillLegacyCards(): Promise<void> {
  if (await getMeta(client, "legacy_cards")) return;

  const itemRes = await client.execute({
    sql: `SELECT id, title, summary, url, source_name, source_type, authors, published_at, interest_id, steelman_content
          FROM items ORDER BY fetched_at DESC LIMIT ?`,
    args: [LEGACY_ITEM_LIMIT],
  });
  for (const r of itemRes.rows as any[]) {
    await paperCardForItem({
      id: Number(r.id),
      title: r.title,
      summary: r.summary,
      url: r.url,
      sourceName: r.source_name,
      sourceType: r.source_type,
      authors: r.authors,
      publishedAt: r.published_at,
      interestId: r.interest_id === null ? null : Number(r.interest_id),
    });
    if (r.steelman_content) {
      const payload: DebatePayload = { claim: firstSentence(r.summary, 240), url: r.url, sourceName: r.source_name };
      await upsertCard({
        type: "debate",
        interestId: r.interest_id === null ? null : Number(r.interest_id),
        level: null,
        itemId: Number(r.id),
        title: r.title,
        body: r.steelman_content,
        payload: payload as unknown as Record<string, unknown>,
        dedupeKey: `item:${r.id}:debate`,
      });
    }
  }

  // Drills grounded in a Library chapter stay private to that chapter and are skipped here.
  const drillRes = await client.execute(
    `SELECT dr.id, dr.interest_id, dr.source_deep_dive_id, dr.drill_type, dr.prompt_content, dr.options,
            dr.correct_option, dr.explanation, dr.concept_label, d.level, d.topic
     FROM drills dr LEFT JOIN deep_dives d ON d.id = dr.source_deep_dive_id
     WHERE dr.source_chapter_id IS NULL`
  );
  for (const r of drillRes.rows as any[]) {
    let options: string[] = [];
    try {
      options = JSON.parse(r.options);
    } catch {}
    if (options.length !== 4) continue;
    const label = DRILL_TYPE_LABELS[r.drill_type as DrillType] ?? "Drill";
    const conceptId = await upsertConcept({
      interestId: Number(r.interest_id),
      name: r.concept_label,
      definition: `${label} practice.`,
      difficulty: 3,
      deepDiveId: r.source_deep_dive_id === null ? null : Number(r.source_deep_dive_id),
    });
    const payload: QuizPayload = {
      options,
      correctIndex: Number(r.correct_option),
      explanation: r.explanation,
      kind: "drill",
      drillLabel: label,
    };
    await upsertCard({
      type: "quiz",
      interestId: Number(r.interest_id),
      level: r.level ?? null,
      conceptId,
      deepDiveId: r.source_deep_dive_id === null ? null : Number(r.source_deep_dive_id),
      seq: 50,
      title: r.topic ?? r.concept_label,
      body: r.prompt_content,
      payload: payload as unknown as Record<string, unknown>,
      dedupeKey: `legacy-drill:${r.id}`,
    });
  }
  await setMeta(client, "legacy_cards", "1");
}

async function insertSearchRow(row: {
  title: string;
  body: string;
  contentType: string;
  sourceId: number;
  interestLabel: string;
  interestId: number | null;
  date: string;
  url: string;
  userId: number | null;
}) {
  const key = `${row.contentType}:${row.sourceId}`;
  await client.execute({ sql: "DELETE FROM search_index WHERE dedupe_key = ?", args: [key] });
  await client.execute({
    sql: `INSERT INTO search_index (title, body, content_type, source_id, interest_label, interest_id, date, url, dedupe_key, user_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [row.title, row.body, row.contentType, row.sourceId, row.interestLabel, row.interestId, row.date, row.url, key, row.userId],
  });
}

/** Rebuilds the search index from source tables (it is fully derivable). */
export async function reindexSearch(): Promise<number> {
  let n = 0;
  const dives = await client.execute(
    `SELECT d.id, d.topic, d.content, d.interest_id, d.created_at, i.name AS interest_name
     FROM deep_dives d JOIN interests i ON i.id = d.interest_id WHERE d.status = 'published'`
  );
  for (const r of dives.rows as any[]) {
    await insertSearchRow({
      title: r.topic, body: r.content, contentType: "deep_dive", sourceId: Number(r.id), interestLabel: r.interest_name,
      interestId: Number(r.interest_id), date: r.created_at, url: `/deep-dive/${r.id}`, userId: null,
    });
    n++;
  }
  const papers = await client.execute(
    `SELECT c.id AS card_id, c.item_id, c.title, c.body, c.interest_id, c.created_at, i.name AS interest_name
     FROM cards c LEFT JOIN interests i ON i.id = c.interest_id WHERE c.type = 'paper' AND c.status = 'published'`
  );
  for (const r of papers.rows as any[]) {
    await insertSearchRow({
      title: r.title, body: r.body, contentType: "news", sourceId: Number(r.item_id ?? r.card_id), interestLabel: r.interest_name ?? "News",
      interestId: r.interest_id === null ? null : Number(r.interest_id), date: r.created_at, url: `/card/${r.card_id}`, userId: null,
    });
    n++;
  }
  const concepts = await client.execute(
    `SELECT c.id, c.name, c.definition, c.interest_id, c.created_at, c.deep_dive_id, i.name AS interest_name
     FROM concepts c JOIN interests i ON i.id = c.interest_id WHERE c.owner_user_id IS NULL AND c.deep_dive_id IS NOT NULL`
  );
  for (const r of concepts.rows as any[]) {
    await insertSearchRow({
      title: r.name, body: r.definition, contentType: "concept", sourceId: Number(r.id), interestLabel: r.interest_name,
      interestId: Number(r.interest_id), date: r.created_at, url: `/deep-dive/${r.deep_dive_id}`, userId: null,
    });
    n++;
  }
  const chapters = await client.execute(
    `SELECT ch.id, ch.title, ch.summary, ch.key_concepts, b.title AS book_title, b.user_id, b.upload_date
     FROM book_chapters ch JOIN books b ON b.id = ch.book_id WHERE ch.summary IS NOT NULL AND b.user_id IS NOT NULL`
  );
  for (const r of chapters.rows as any[]) {
    let kc = "";
    try {
      kc = (JSON.parse(r.key_concepts ?? "[]") as { term: string; definition: string }[]).map((k) => `${k.term}: ${k.definition}`).join("\n");
    } catch {}
    await insertSearchRow({
      title: r.title, body: `${r.summary}\n\n${kc}`, contentType: "chapter", sourceId: Number(r.id), interestLabel: `Library: ${r.book_title}`,
      interestId: null, date: r.upload_date, url: `/library/chapter/${r.id}`, userId: Number(r.user_id),
    });
    n++;
  }
  const ebs = await client.execute(
    `SELECT e.id, e.user_explanation, e.feedback, e.created_at, e.deep_dive_id, e.chapter_id, e.user_id,
            d.topic, ch.title AS chapter_title
     FROM explain_backs e LEFT JOIN deep_dives d ON d.id = e.deep_dive_id LEFT JOIN book_chapters ch ON ch.id = e.chapter_id
     WHERE e.user_id IS NOT NULL`
  );
  for (const r of ebs.rows as any[]) {
    await insertSearchRow({
      title: `Explain it back — ${r.topic ?? r.chapter_title ?? "entry"}`, body: `${r.user_explanation}\n\n${r.feedback}`,
      contentType: "explain_back", sourceId: Number(r.id), interestLabel: r.chapter_id ? "Library" : "Explain it back", interestId: null,
      date: r.created_at, url: r.chapter_id ? `/library/chapter/${r.chapter_id}` : `/deep-dive/${r.deep_dive_id}`, userId: Number(r.user_id),
    });
    n++;
  }
  return n;
}

export async function bootstrapContent(): Promise<void> {
  await seedStaticCards();
  await backfillLegacyCards();
  if ((await getMeta(client, "search_reindex_needed")) === "1") {
    await reindexSearch();
    await setMeta(client, "search_reindex_needed", "0");
  }
}

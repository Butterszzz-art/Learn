import { db } from "@/db";
import {
  digests,
  items,
  brainFacts,
  settings,
  deepDives,
  appliedInsights,
  interests,
  coveredTopics,
  drills,
  explainBacks,
  mentalModels,
  modelUsage,
  rabbitHoles,
  books,
  bookChapters,
} from "@/db/schema";
import type { Category, Level, DrillType, BookStatus } from "@/db/schema";
import { eq, desc, and, or, inArray, isNotNull, lte, asc } from "drizzle-orm";
import { pickBrainGames, type BrainGamePick } from "./brainGames";

export interface NewsItem {
  id: number;
  title: string;
  authors: string | null;
  summary: string;
  sourceName: string;
  sourceType: string; // "academic" | "journalism" | "generated"
  category: Category | null;
  url: string;
  publishedAt: string | null;
  score: number;
  // Steelman companion (Phase 6): the strongest good-faith counterargument
  // to this item's thesis, if one was generated — null for most items.
  steelmanContent: string | null;
}

export interface DeepDiveSummary {
  id: number;
  topic: string;
  contentPreview: string;
  level: Level;
  createdAt: string;
  sourceCount: number;
}

export interface AppliedInsightSummary {
  id: number;
  content: string;
  createdAt: string;
}

export interface DrillSummary {
  id: number;
  drillType: DrillType;
  promptContent: string;
  options: string[];
  correctOption: number;
  explanation: string;
  conceptLabel: string;
  // Set when grounded in a real deep dive — lets the card link back with
  // "based on today's [Interest] deep-dive". Null for standalone logic drills.
  sourceDeepDiveId: number | null;
  sourceDeepDiveTopic: string | null;
}

export interface InterestFeedSection {
  interestId: number;
  interestName: string;
  interestSlug: string;
  isFavorite: boolean;
  news: NewsItem[];
  // A cycle normally has one deep dive per interest, but a favorited
  // (Passion Mode) interest can have more — see FAVORITE_DEEP_DIVE_QUOTA in
  // pipeline.ts — plus curiosity-branching/Binge on-demand additions.
  deepDives: DeepDiveSummary[];
  appliedInsights: AppliedInsightSummary[];
  drills: DrillSummary[];
}

export interface DueReviewTopic {
  coveredTopicId: number;
  interestId: number;
  interestName: string;
  topic: string;
  deepDiveId: number | null;
  chapterId: number | null; // Phase 7: set instead of deepDiveId for a Library concept
  contentPreview: string;
  coveredDaysAgo: number;
}

export interface MentalModelOfTheDay {
  id: number; // model_usage row id
  modelName: string;
  category: string;
  lensText: string;
  linkedItems: { id: number; title: string; interestName: string }[];
}

export interface RabbitHoleOfTheDay {
  id: number;
  title: string;
  summary: string;
  url: string;
  sourceName: string;
  topicArea: string;
}

export interface BookChapterPointer {
  bookId: number;
  bookTitle: string;
  chapterIds: number[];
  chapterNumbers: number[];
}

export interface CycleFeed {
  cycleId: number;
  periodLabel: string;
  frequency: string;
  createdAt: string;
  brainFact: { text: string; topic: string | null } | null;
  showBrainFact: boolean;
  sections: InterestFeedSection[];
  totalEntries: number;
  // Plain, non-punitive progress count — see ProgressIndicator. Never a
  // streak, never framed as "at risk".
  progress: { conceptsThisMonth: number; interestsCount: number };
  // At most one topic due for spaced review, surfaced as a "Remember this?"
  // card. Only rendered on the live/current feed, not archive views.
  dueReview: DueReviewTopic | null;
  // Once per cycle each, visually distinct from the per-interest sections.
  mentalModelOfTheDay: MentalModelOfTheDay | null;
  rabbitHoleOfTheDay: RabbitHoleOfTheDay | null;
  // Null when the "Include brain games" setting is off — distinct from an
  // empty array, which would mean the setting is on but the bank is empty.
  brainGames: BrainGamePick[] | null;
  // One pointer per book that surfaced chapter(s) this cycle — a short
  // "Chapter N of [Book] is ready" card, not the chapter content itself.
  bookChaptersOfTheDay: BookChapterPointer[];
}

function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function previewOf(md: string, max = 220): string {
  const plain = stripMarkdown(md);
  if (plain.length <= max) return plain;
  return plain.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

/**
 * Builds the bounded feed for one cycle, restricted to the given interest
 * ids (the enabled set at read time — an interest disabled after a cycle
 * was compiled simply drops out of view, without deleting anything).
 * Grouped by interest; within each interest, News / Deep Dive / Applied
 * Insight are clearly separate sections (Phase 3).
 */
async function loadCycleFeed(cycleId: number, enabledInterestIds: number[]): Promise<CycleFeed | null> {
  const cycleRows = await db.select().from(digests).where(eq(digests.id, cycleId)).limit(1);
  const cycle = cycleRows[0];
  if (!cycle) return null;

  if (enabledInterestIds.length === 0) {
    return {
      cycleId: cycle.id,
      periodLabel: cycle.periodLabel,
      frequency: cycle.frequency,
      createdAt: cycle.createdAt,
      brainFact: null,
      showBrainFact: false,
      sections: [],
      totalEntries: 0,
      progress: { conceptsThisMonth: 0, interestsCount: 0 },
      dueReview: null,
      mentalModelOfTheDay: null,
      rabbitHoleOfTheDay: null,
      brainGames: await getBrainGamesIfEnabled(),
      bookChaptersOfTheDay: await getBookChaptersOfTheDay(cycleId),
    };
  }

  const allInterests = await db.select().from(interests);
  const interestById = new Map(allInterests.map((i) => [i.id, i]));
  const enabledSet = new Set(enabledInterestIds);

  const itemRows = await db.select().from(items).where(eq(items.digestId, cycleId));
  const diveRows = await db.select().from(deepDives).where(eq(deepDives.digestId, cycleId));
  const drillRows = await db
    .select({ drill: drills, sourceDive: deepDives })
    .from(drills)
    .leftJoin(deepDives, eq(drills.sourceDeepDiveId, deepDives.id))
    .where(eq(drills.digestId, cycleId));
  // LEFT JOIN both possible sources (an insight grounds in exactly one) and
  // filter by either's digestId — an INNER JOIN on deepDives alone would
  // silently drop drill-grounded insights (e.g. Critical Thinking &
  // Argumentation, whose primary content is Drills, not Deep Dives).
  const insightRows = await db
    .select({ insight: appliedInsights, dive: deepDives, drill: drills })
    .from(appliedInsights)
    .leftJoin(deepDives, eq(appliedInsights.deepDiveId, deepDives.id))
    .leftJoin(drills, eq(appliedInsights.drillId, drills.id))
    .where(or(eq(deepDives.digestId, cycleId), eq(drills.digestId, cycleId)));

  const sectionsById = new Map<number, InterestFeedSection>();
  function getSection(interestId: number): InterestFeedSection | null {
    if (!enabledSet.has(interestId)) return null;
    let section = sectionsById.get(interestId);
    if (!section) {
      const interest = interestById.get(interestId);
      section = {
        interestId,
        interestName: interest?.name ?? "Unknown",
        interestSlug: interest?.slug ?? "unknown",
        isFavorite: interest?.isFavorite ?? false,
        news: [],
        deepDives: [],
        appliedInsights: [],
        drills: [],
      };
      sectionsById.set(interestId, section);
    }
    return section;
  }

  for (const r of itemRows) {
    if (r.interestId == null) continue;
    const section = getSection(r.interestId);
    if (!section) continue;
    section.news.push({
      id: r.id,
      title: r.title,
      authors: r.authors,
      summary: r.summary,
      sourceName: r.sourceName,
      sourceType: r.sourceType,
      category: r.category,
      url: r.url,
      publishedAt: r.publishedAt,
      score: r.score,
      steelmanContent: r.steelmanContent,
    });
  }

  for (const r of diveRows) {
    const section = getSection(r.interestId);
    if (!section) continue;
    let sourceCount = 0;
    try {
      sourceCount = (JSON.parse(r.sources) as unknown[]).length;
    } catch {
      sourceCount = 0;
    }
    section.deepDives.push({
      id: r.id,
      topic: r.topic,
      contentPreview: previewOf(r.content),
      level: r.level,
      createdAt: r.createdAt,
      sourceCount,
    });
  }

  for (const { drill, sourceDive } of drillRows) {
    const section = getSection(drill.interestId);
    if (!section) continue;
    let options: string[] = [];
    try {
      options = JSON.parse(drill.options);
    } catch {
      options = [];
    }
    section.drills.push({
      id: drill.id,
      drillType: drill.drillType,
      promptContent: drill.promptContent,
      options,
      correctOption: drill.correctOption,
      explanation: drill.explanation,
      conceptLabel: drill.conceptLabel,
      sourceDeepDiveId: sourceDive?.id ?? null,
      sourceDeepDiveTopic: sourceDive?.topic ?? null,
    });
  }

  for (const { insight, dive, drill } of insightRows) {
    const interestId = dive?.interestId ?? drill?.interestId;
    if (interestId == null) continue;
    const section = getSection(interestId);
    if (!section) continue;
    section.appliedInsights.push({ id: insight.id, content: insight.content, createdAt: insight.createdAt });
  }

  for (const section of sectionsById.values()) {
    section.news.sort((a, b) => b.score - a.score);
  }

  // Stable order: interest creation order (roughly onboarding order).
  const sections = allInterests
    .filter((i) => sectionsById.has(i.id))
    .map((i) => sectionsById.get(i.id)!);

  const totalEntries = sections.reduce(
    (sum, s) => sum + s.news.length + s.deepDives.length + s.appliedInsights.length + s.drills.length,
    0
  );

  let brainFact: { text: string; topic: string | null } | null = null;
  if (cycle.brainFactId) {
    const factRows = await db.select().from(brainFacts).where(eq(brainFacts.id, cycle.brainFactId)).limit(1);
    if (factRows[0]) brainFact = { text: factRows[0].text, topic: factRows[0].topic };
  }
  const neuroInterest = allInterests.find((i) => i.slug === "neuroscience");
  const showBrainFact = !!neuroInterest && enabledSet.has(neuroInterest.id);

  // Library books' hidden pseudo-interests (see getOrCreateLibraryInterest)
  // never appear in enabledInterestIds — they never get a userInterests row
  // — but their covered concepts should still count toward progress and be
  // eligible for spaced resurfacing, same as any interest's. Included here,
  // not in enabledSet above, so they don't spawn a phantom section in the
  // main feed (Library content has its own dedicated space).
  const libraryInterestIds = allInterests.filter((i) => i.isLibraryBook).map((i) => i.id);
  const progressInterestIds = [...enabledInterestIds, ...libraryInterestIds];

  // Plain progress count: how many topics have been covered this calendar
  // month across the enabled interests (+ any Library books), and how many
  // distinct interests that spans. Deliberately not a streak — see
  // ProgressIndicator.tsx.
  const progress = await getMonthlyProgress(progressInterestIds);

  // At most one topic due for spaced review, earliest-due first. Computed
  // for every cycle load (cheap, single-user dataset) but only rendered on
  // the live feed, not archive views — see Feed.tsx's isArchive prop.
  const dueReview = await getDueReviewTopic(progressInterestIds, interestById);

  const mentalModelOfTheDay = await getMentalModelOfTheDay(cycleId);
  const rabbitHoleOfTheDay = await getRabbitHoleOfTheDay(cycleId);
  const brainGamesList = await getBrainGamesIfEnabled();
  const bookChaptersOfTheDay = await getBookChaptersOfTheDay(cycleId);

  return {
    cycleId: cycle.id,
    periodLabel: cycle.periodLabel,
    frequency: cycle.frequency,
    createdAt: cycle.createdAt,
    brainFact,
    showBrainFact,
    sections,
    totalEntries,
    progress,
    dueReview,
    mentalModelOfTheDay,
    rabbitHoleOfTheDay,
    brainGames: brainGamesList,
    bookChaptersOfTheDay,
  };
}

/** One pointer card per book that surfaced chapter(s) this cycle — see
 * BookChapterPointer. Chapters themselves render in Library, not here. */
async function getBookChaptersOfTheDay(cycleId: number): Promise<BookChapterPointer[]> {
  const rows = await db
    .select({ chapter: bookChapters, book: books })
    .from(bookChapters)
    .innerJoin(books, eq(bookChapters.bookId, books.id))
    .where(eq(bookChapters.digestId, cycleId))
    .orderBy(asc(bookChapters.chapterNumber));

  const byBook = new Map<number, BookChapterPointer>();
  for (const { chapter, book } of rows) {
    let entry = byBook.get(book.id);
    if (!entry) {
      entry = { bookId: book.id, bookTitle: book.title, chapterIds: [], chapterNumbers: [] };
      byBook.set(book.id, entry);
    }
    entry.chapterIds.push(chapter.id);
    entry.chapterNumbers.push(chapter.chapterNumber);
  }
  return [...byBook.values()];
}

async function getMentalModelOfTheDay(cycleId: number): Promise<MentalModelOfTheDay | null> {
  const rows = await db
    .select({ usage: modelUsage, model: mentalModels })
    .from(modelUsage)
    .innerJoin(mentalModels, eq(modelUsage.modelId, mentalModels.id))
    .where(eq(modelUsage.digestId, cycleId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  // Phase 7 widened this from plain number[] (always an item) to
  // {type, id}[] (item or book chapter) — a bare number in an older row
  // means {type: "item", id: number}.
  let rawRefs: unknown[] = [];
  try {
    rawRefs = JSON.parse(row.usage.linkedItemIds);
  } catch {
    rawRefs = [];
  }
  const refs = rawRefs.map((r) =>
    typeof r === "number" ? { type: "item" as const, id: r } : (r as { type: "item" | "chapter"; id: number })
  );
  const itemIds = refs.filter((r) => r.type === "item").map((r) => r.id);
  const chapterIds = refs.filter((r) => r.type === "chapter").map((r) => r.id);

  const linkedItems: { id: number; title: string; interestName: string }[] = [];
  if (itemIds.length > 0) {
    const itemRows = await db
      .select({ item: items, interest: interests })
      .from(items)
      .leftJoin(interests, eq(items.interestId, interests.id))
      .where(inArray(items.id, itemIds));
    linkedItems.push(
      ...itemRows.map((r) => ({ id: r.item.id, title: r.item.title, interestName: r.interest?.name ?? "Unknown" }))
    );
  }
  if (chapterIds.length > 0) {
    const chapterRows = await db
      .select({ chapter: bookChapters, book: books })
      .from(bookChapters)
      .innerJoin(books, eq(bookChapters.bookId, books.id))
      .where(inArray(bookChapters.id, chapterIds));
    linkedItems.push(
      ...chapterRows.map((r) => ({
        id: r.chapter.id,
        title: r.chapter.title,
        interestName: `Library: ${r.book.title}`,
      }))
    );
  }

  return {
    id: row.usage.id,
    modelName: row.model.name,
    category: row.model.category,
    lensText: row.usage.lensText,
    linkedItems,
  };
}

async function getRabbitHoleOfTheDay(cycleId: number): Promise<RabbitHoleOfTheDay | null> {
  const rows = await db.select().from(rabbitHoles).where(eq(rabbitHoles.digestId, cycleId)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    url: row.url,
    sourceName: row.sourceName,
    topicArea: row.topicArea,
  };
}

/** Null (not shown) unless the "Include brain games" setting is on —
 * distinct from an empty array. Picking is cheap and idempotent per day
 * (see pickBrainGames), so it's safe to call on every feed read. */
async function getBrainGamesIfEnabled(): Promise<BrainGamePick[] | null> {
  const rows = await db.select({ includeBrainGames: settings.includeBrainGames }).from(settings).where(eq(settings.id, 1)).limit(1);
  if (!rows[0]?.includeBrainGames) return null;
  return pickBrainGames();
}

/** Parses SQLite's `current_timestamp` text shape ("YYYY-MM-DD HH:MM:SS",
 * UTC, no offset) into a Date. Shared by the two helpers below. */
function parseSqliteTimestamp(raw: string): Date {
  return new Date(raw.replace(" ", "T") + "Z");
}

async function getMonthlyProgress(
  enabledInterestIds: number[]
): Promise<{ conceptsThisMonth: number; interestsCount: number }> {
  if (enabledInterestIds.length === 0) return { conceptsThisMonth: 0, interestsCount: 0 };

  const rows = await db
    .select({ interestId: coveredTopics.interestId, dateCovered: coveredTopics.dateCovered })
    .from(coveredTopics)
    .where(inArray(coveredTopics.interestId, enabledInterestIds));

  const now = new Date();
  const interestsSeen = new Set<number>();
  let conceptsThisMonth = 0;
  for (const r of rows) {
    const d = parseSqliteTimestamp(r.dateCovered);
    if (!isNaN(d.getTime()) && d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth()) {
      conceptsThisMonth++;
      interestsSeen.add(r.interestId);
    }
  }
  return { conceptsThisMonth, interestsCount: interestsSeen.size };
}

async function getDueReviewTopic(
  enabledInterestIds: number[],
  interestById: Map<number, typeof interests.$inferSelect>
): Promise<DueReviewTopic | null> {
  if (enabledInterestIds.length === 0) return null;

  const nowSqlite = new Date().toISOString().slice(0, 19).replace("T", " ");
  const dueRows = await db
    .select({ ct: coveredTopics, dive: deepDives, chapter: bookChapters })
    .from(coveredTopics)
    .leftJoin(deepDives, eq(coveredTopics.deepDiveId, deepDives.id))
    .leftJoin(bookChapters, eq(coveredTopics.chapterId, bookChapters.id))
    .where(
      and(
        inArray(coveredTopics.interestId, enabledInterestIds),
        isNotNull(coveredTopics.nextReviewDate),
        lte(coveredTopics.nextReviewDate, nowSqlite)
      )
    )
    .orderBy(asc(coveredTopics.nextReviewDate))
    .limit(1);

  const due = dueRows[0];
  if (!due) return null;

  const coveredAt = parseSqliteTimestamp(due.ct.dateCovered);
  const coveredDaysAgo = isNaN(coveredAt.getTime())
    ? 0
    : Math.max(0, Math.round((Date.now() - coveredAt.getTime()) / 86400000));

  const contentPreview = due.dive
    ? previewOf(due.dive.content, 400)
    : due.chapter?.summary
      ? previewOf(due.chapter.summary, 400)
      : "";

  return {
    coveredTopicId: due.ct.id,
    interestId: due.ct.interestId,
    interestName: interestById.get(due.ct.interestId)?.name ?? "Unknown",
    topic: due.ct.topic,
    deepDiveId: due.dive?.id ?? null,
    chapterId: due.chapter?.id ?? null,
    contentPreview,
    coveredDaysAgo,
  };
}

/** The current (most recent) cycle's feed, restricted to enabled interests. */
export async function getCurrentFeed(enabledInterestIds: number[]): Promise<CycleFeed | null> {
  const latest = await db.select().from(digests).orderBy(desc(digests.id)).limit(1);
  if (!latest[0]) return null;
  return loadCycleFeed(latest[0].id, enabledInterestIds);
}

export async function getFeedByCycleId(
  cycleId: number,
  enabledInterestIds: number[]
): Promise<CycleFeed | null> {
  return loadCycleFeed(cycleId, enabledInterestIds);
}

export interface CycleListEntry {
  id: number;
  periodLabel: string;
  frequency: string;
  createdAt: string;
  newsCount: number;
  deepDiveCount: number;
  insightCount: number;
  drillCount: number;
}

/** All cycles, newest first, for the Archive view. */
export async function listCycles(): Promise<CycleListEntry[]> {
  const rows = await db.select().from(digests).orderBy(desc(digests.id));
  const out: CycleListEntry[] = [];
  for (const d of rows) {
    const itemRows = await db.select({ id: items.id }).from(items).where(eq(items.digestId, d.id));
    const diveRows = await db.select({ id: deepDives.id }).from(deepDives).where(eq(deepDives.digestId, d.id));
    const drillRows = await db.select({ id: drills.id }).from(drills).where(eq(drills.digestId, d.id));
    // LEFT JOIN both possible sources, same reasoning as loadCycleFeed above
    // — an INNER JOIN on deepDives alone undercounts drill-grounded insights.
    const insightRows = await db
      .select({ id: appliedInsights.id })
      .from(appliedInsights)
      .leftJoin(deepDives, eq(appliedInsights.deepDiveId, deepDives.id))
      .leftJoin(drills, eq(appliedInsights.drillId, drills.id))
      .where(or(eq(deepDives.digestId, d.id), eq(drills.digestId, d.id)));
    out.push({
      id: d.id,
      periodLabel: d.periodLabel,
      frequency: d.frequency,
      createdAt: d.createdAt,
      newsCount: itemRows.length,
      deepDiveCount: diveRows.length,
      insightCount: insightRows.length,
      drillCount: drillRows.length,
    });
  }
  return out;
}

export interface ExplainBackEntry {
  id: number;
  userExplanation: string;
  feedback: string;
  createdAt: string;
}

export interface DeepDiveDetail {
  id: number;
  interestId: number;
  topic: string;
  content: string;
  sources: { title: string; url: string }[];
  level: Level;
  interestName: string;
  interestSlug: string;
  createdAt: string;
  appliedInsight: string | null;
  followUpTopics: { topic: string; teaser: string }[];
  selfCheckQuestions: {
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  }[];
  // Explain-it-back (Phase 6): null means the default "explain this back in
  // your own words" prompt; set to a real open question for occasional
  // essay-style prompts on advanced/research_level interests.
  essayPrompt: string | null;
  explainBacks: ExplainBackEntry[];
}

function parseJsonArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function getDeepDiveById(id: number): Promise<DeepDiveDetail | null> {
  const rows = await db.select().from(deepDives).where(eq(deepDives.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  const interestRows = await db.select().from(interests).where(eq(interests.id, row.interestId)).limit(1);
  const interest = interestRows[0];
  let sources: { title: string; url: string }[] = [];
  try {
    sources = JSON.parse(row.sources);
  } catch {
    sources = [];
  }
  const insightRows = await db
    .select({ content: appliedInsights.content })
    .from(appliedInsights)
    .where(eq(appliedInsights.deepDiveId, id))
    .limit(1);

  const explainBackRows = await db
    .select()
    .from(explainBacks)
    .where(eq(explainBacks.deepDiveId, id))
    .orderBy(desc(explainBacks.createdAt));

  return {
    id: row.id,
    interestId: row.interestId,
    topic: row.topic,
    content: row.content,
    sources,
    level: row.level,
    interestName: interest?.name ?? "Unknown",
    interestSlug: interest?.slug ?? "unknown",
    createdAt: row.createdAt,
    appliedInsight: insightRows[0]?.content ?? null,
    followUpTopics: parseJsonArray(row.followUpTopics),
    selfCheckQuestions: parseJsonArray(row.selfCheckQuestions),
    essayPrompt: row.essayPrompt,
    explainBacks: explainBackRows.map((r) => ({
      id: r.id,
      userExplanation: r.userExplanation,
      feedback: r.feedback,
      createdAt: r.createdAt,
    })),
  };
}

export interface AppSettings {
  frequency: "daily" | "weekly";
  lastRefreshAt: string | null;
  // Brain Games (Phase 6): opt-in, off by default — not part of the
  // interests system.
  includeBrainGames: boolean;
}

export async function getAppSettings(): Promise<AppSettings> {
  const rows = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  const row = rows[0];
  return {
    frequency: (row?.frequency as "daily" | "weekly") ?? "daily",
    lastRefreshAt: row?.lastRefreshAt ?? null,
    includeBrainGames: row?.includeBrainGames ?? false,
  };
}

export async function updateAppSettings(update: { frequency?: "daily" | "weekly"; includeBrainGames?: boolean }) {
  const patch: Record<string, unknown> = {};
  if (update.frequency) patch.frequency = update.frequency;
  if (typeof update.includeBrainGames === "boolean") patch.includeBrainGames = update.includeBrainGames;
  if (Object.keys(patch).length === 0) return;
  await db.update(settings).set(patch).where(eq(settings.id, 1));
}

// ---------------------------------------------------------------------------
// Library (Phase 7) — read-side queries for the book list, table of
// contents, and chapter notebook views.
// ---------------------------------------------------------------------------

export interface BookListEntry {
  id: number;
  title: string;
  author: string | null;
  status: BookStatus;
  errorMessage: string | null;
  totalChapters: number;
  chaptersProcessed: number; // have content generated, regardless of surfaced yet
  chaptersSurfaced: number;
  paceChaptersPerCycle: number;
  uploadDate: string;
}

/** Every uploaded book, newest first, with processing/drip-feed progress —
 * for the Library page's list. */
export async function getLibraryBooks(): Promise<BookListEntry[]> {
  const rows = await db.select().from(books).orderBy(desc(books.uploadDate));
  const out: BookListEntry[] = [];
  for (const b of rows) {
    const chapterRows = await db
      .select({ summary: bookChapters.summary, status: bookChapters.status })
      .from(bookChapters)
      .where(eq(bookChapters.bookId, b.id));
    out.push({
      id: b.id,
      title: b.title,
      author: b.author,
      status: b.status,
      errorMessage: b.errorMessage,
      totalChapters: b.totalChapters,
      chaptersProcessed: chapterRows.filter((c) => c.summary != null).length,
      chaptersSurfaced: chapterRows.filter((c) => c.status === "surfaced").length,
      paceChaptersPerCycle: b.paceChaptersPerCycle,
      uploadDate: b.uploadDate,
    });
  }
  return out;
}

export interface BookChapterListEntry {
  id: number;
  chapterNumber: number;
  title: string;
  status: "pending" | "surfaced";
  hasContent: boolean; // content generated, regardless of surfaced yet
}

export interface BookDetail {
  id: number;
  title: string;
  author: string | null;
  status: BookStatus;
  errorMessage: string | null;
  totalChapters: number;
  paceChaptersPerCycle: number;
  chapters: BookChapterListEntry[];
}

/** One book's full table of contents — the Library always shows every
 * chapter, surfaced or not, so the reader can jump ahead or reread any time. */
export async function getBookById(id: number): Promise<BookDetail | null> {
  const rows = await db.select().from(books).where(eq(books.id, id)).limit(1);
  const book = rows[0];
  if (!book) return null;

  const chapterRows = await db
    .select()
    .from(bookChapters)
    .where(eq(bookChapters.bookId, id))
    .orderBy(asc(bookChapters.chapterNumber));

  return {
    id: book.id,
    title: book.title,
    author: book.author,
    status: book.status,
    errorMessage: book.errorMessage,
    totalChapters: book.totalChapters,
    paceChaptersPerCycle: book.paceChaptersPerCycle,
    chapters: chapterRows.map((c) => ({
      id: c.id,
      chapterNumber: c.chapterNumber,
      title: c.title,
      status: c.status,
      hasContent: c.summary != null,
    })),
  };
}

export interface ChapterDetail {
  id: number;
  bookId: number;
  bookTitle: string;
  chapterNumber: number;
  title: string;
  summary: string | null;
  keyConcepts: { term: string; definition: string }[];
  notableArguments: string[];
  quotes: string[];
  explainBacks: ExplainBackEntry[];
}

/** One chapter's full notebook entry — the "read it in Library" destination
 * for the main feed's pointer card, and for jumping ahead from the table of
 * contents. Null if the chapter's content hasn't been generated yet. */
export async function getChapterById(id: number): Promise<ChapterDetail | null> {
  const rows = await db
    .select({ chapter: bookChapters, book: books })
    .from(bookChapters)
    .innerJoin(books, eq(bookChapters.bookId, books.id))
    .where(eq(bookChapters.id, id))
    .limit(1);
  const row = rows[0];
  if (!row || row.chapter.summary == null) return null;

  const explainBackRows = await db
    .select()
    .from(explainBacks)
    .where(eq(explainBacks.chapterId, id))
    .orderBy(desc(explainBacks.createdAt));

  return {
    id: row.chapter.id,
    bookId: row.book.id,
    bookTitle: row.book.title,
    chapterNumber: row.chapter.chapterNumber,
    title: row.chapter.title,
    summary: row.chapter.summary,
    keyConcepts: parseJsonArray(row.chapter.keyConcepts),
    notableArguments: parseJsonArray(row.chapter.notableArguments),
    quotes: parseJsonArray(row.chapter.quotes),
    explainBacks: explainBackRows.map((r) => ({
      id: r.id,
      userExplanation: r.userExplanation,
      feedback: r.feedback,
      createdAt: r.createdAt,
    })),
  };
}

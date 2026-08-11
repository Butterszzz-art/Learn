import { db, client } from "@/db";
import {
  digests,
  items,
  settings,
  deepDives,
  appliedInsights,
  drills,
  explainBacks,
  mentalModels,
  modelUsage,
  rabbitHoles,
  books,
  bookChapters,
} from "@/db/schema";
import type { Category, Level } from "@/db/schema";
import { bumpLevel } from "@/db/schema";
import { eq, and, gte, desc, isNotNull, isNull, notInArray } from "drizzle-orm";
import { fetchForInterest } from "./fetchers/registry";
import { generateFieldNewsRoundup } from "./newsRoundup";
import { dedupeItems, dedupeKeyFor } from "./dedupe";
import { categorizeByKeywords } from "./categorize";
import { classifyAndSummarizeBatch, summarizeBatch, hasClaudeKey } from "./claude";
import { fetchArticleText } from "./articleFetch";
import { indexForSearch } from "./searchIndex";
import {
  generateDeepDive,
  generateAppliedInsight,
  generateFollowUpTopics,
  generateSelfCheckQuestions,
} from "./deepDive";
import { generateGroundedDrill, generateStandaloneLogicDrill } from "./drills";
import { generateExplainBackFeedback, generateEssayPrompt } from "./explainBack";
import { generateMentalModelLens } from "./mentalModelLens";
import { generateSteelmans } from "./steelman";
import { generateRabbitHole } from "./rabbitHole";
import { scoreItem } from "./score";
import { pickBrainFactOfTheDay, maybeGenerateWeeklyFacts } from "./brainFact";
import {
  getEnabledInterests,
  getInterestById,
  getInterestBySlug,
  getCoveredTopics,
  addCoveredTopic,
  addCoveredTopicFromChapter,
  getOrCreateLibraryInterest,
} from "./interests";
import type { InterestWithConfig } from "./interests";
import type { RawItem, ProcessedItem } from "./types";

const TARGET_ITEMS_PER_INTEREST = 8; // curated (RSS/API) sources
const TARGET_ROUNDUP_ITEMS = 5; // generated Field News Roundup
// Passion Mode: favorited interests get this many deep dives per cycle
// instead of 1. Kept modest (not the full "2-3" range) to bound API cost —
// see README if you want to raise it.
const FAVORITE_DEEP_DIVE_QUOTA = 2;
// Drills (Phase 5): "1-2 drills" grounded in real recent deep-dive content
// per cycle, scanned across ALL interests.
const GROUNDED_DRILL_TARGET = 2;
const GROUNDED_DRILL_LOOKBACK_DAYS = 4;
const GROUNDED_DRILL_MAX_CANDIDATES = 5; // bounds Claude calls even with a large recent-dive pool

// Phase 6 constants.
// Explain-it-back: for advanced/research_level interests, roughly 1 in 7
// deep dives gets a real essay-style open question instead of the default
// "explain this back" prompt — matches the spec's "roughly weekly" for a
// daily cycle without needing extra state to track elapsed time.
const ESSAY_PROMPT_CHANCE = 1 / 7;
const ESSAY_PROMPT_LEVELS: Level[] = ["advanced", "research_level"];
// Mental Model of the Day: how many recent usages to look back on when
// picking an unused-recently model, and how many of today's items to offer
// as candidates for the lens to connect to.
const MODEL_USAGE_LOOKBACK = 15;
const MENTAL_MODEL_ITEM_CANDIDATES = 12;
// Steelman: only for interests where argument is central, capped per cycle
// to control API cost (each generation call uses web_search).
const STEELMAN_ELIGIBLE_SLUGS = new Set(["political-science", "economics", "philosophy", "critical-thinking"]);
const STEELMAN_TARGET_PER_INTEREST = 2;
const STEELMAN_CANDIDATE_POOL = 8;
// Rabbit Hole: how many recently-shown topic areas to avoid repeating.
const RABBIT_HOLE_AVOID_LOOKBACK = 20;

// Phase 7 (Library) — modelUsage.linkedItemIds entry shape. Widened from
// Phase 6's plain number[] to also reference a book chapter, not just a
// News item.
type LinkedItemRef = { type: "item" | "chapter"; id: number };

export interface PipelineResult {
  cycleId: number;
  newsAdded: number;
  deepDivesAdded: number;
  appliedInsightsAdded: number;
  drillsAdded: number;
  mentalModelAdded: boolean;
  rabbitHoleAdded: boolean;
  chaptersSurfaced: number;
  fetchedCount: number;
  usedClaude: boolean;
  newBrainFacts: number;
  enabledInterestCount: number;
}

interface InterestCycleResult {
  newsAdded: number;
  fetched: number;
  deepDiveAdded: boolean;
  insightAdded: boolean;
}

function truncateSnippet(snippet: string, max = 300): string {
  const s = (snippet || "").trim();
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

// bioRxiv (and occasionally other feeds) serve the literal string
// "placeholder" as filler abstract text for preprints posted too recently
// to be fully indexed yet. Treat it the same as an empty snippet rather
// than showing that one word as the "summary".
const USELESS_SUMMARY_RE = /^placeholder\.?$/i;

function cleanSummary(summary: string | undefined | null, fallbackSnippet: string): string {
  const s = (summary || "").trim();
  if (!s || USELESS_SUMMARY_RE.test(s)) {
    return truncateSnippet(fallbackSnippet) || "No summary available yet — check the source directly.";
  }
  return s;
}

/**
 * Phase 10: builds the text actually fed to Claude for each item's News
 * summary. Sources with a real structured abstract (hasFullAbstract —
 * PubMed, arXiv, bioRxiv) use that abstract directly, already substantial
 * enough. Everything else — plain RSS feeds (including NBER's, which is
 * tagged sourceType "academic" but has no real abstract) and web-search-
 * grounded Field News Roundup items — gets its linked article page fetched
 * and its main text extracted first, since the raw snippet alone is too
 * thin to build a genuine abstract-style summary from. Falls back to the
 * item's original snippet on any fetch/extraction failure — one flaky page
 * should never block the whole News refresh.
 */
async function buildSummaryTexts(items: RawItem[]): Promise<string[]> {
  return Promise.all(
    items.map(async (item) => {
      if (item.hasFullAbstract) return item.snippet;
      try {
        const fetched = await fetchArticleText(item.url);
        return fetched ?? item.snippet;
      } catch (err) {
        console.error(`[pipeline] Article fetch failed for "${item.title}":`, err);
        return item.snippet;
      }
    })
  );
}

async function getFrequency(): Promise<"daily" | "weekly"> {
  const rows = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  return (rows[0]?.frequency as "daily" | "weekly") ?? "daily";
}

function periodLabel(frequency: "daily" | "weekly"): string {
  const now = new Date();
  if (frequency === "daily") {
    return now.toISOString().slice(0, 10); // YYYY-MM-DD
  }
  // Week starting on the most recent Monday.
  const day = now.getUTCDay(); // 0 = Sunday
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - diffToMonday);
  return `Week of ${monday.toISOString().slice(0, 10)}`;
}

/**
 * Finds the digest ("cycle") row for the current period, or creates one.
 * Multiple refreshes within the same day/week accumulate into the SAME
 * cycle — this is what makes the "You're caught up" bounded feed meaningful.
 */
async function findOrCreateCurrentCycle(frequency: "daily" | "weekly"): Promise<number> {
  const label = periodLabel(frequency);
  const existing = await db.select().from(digests).where(eq(digests.periodLabel, label)).limit(1);
  if (existing[0]) return existing[0].id;
  const inserted = await db
    .insert(digests)
    .values({ periodLabel: label, frequency })
    .returning({ id: digests.id });
  return inserted[0].id;
}

async function ensureCycleHasBrainFact(cycleId: number): Promise<number> {
  const rows = await db.select().from(digests).where(eq(digests.id, cycleId)).limit(1);
  if (rows[0] && !rows[0].brainFactId) {
    const fact = await pickBrainFactOfTheDay();
    if (fact) {
      await db.update(digests).set({ brainFactId: fact.id }).where(eq(digests.id, cycleId));
    }
  }
  return cycleId;
}

/**
 * Resolves the current cycle id, creating it (with its Brain Fact) if this
 * is the first call this period. Idempotent and cheap — safe to call once
 * per step, per interest, per HTTP request; this is what lets the granular
 * refreshXForInterest functions below be fully self-contained.
 */
export async function getOrCreateCurrentCycleId(): Promise<number> {
  const frequency = await getFrequency();
  return ensureCycleHasBrainFact(await findOrCreateCurrentCycle(frequency));
}

// ---------------------------------------------------------------------------
// Granular, per-interest, per-step entry points. Each is a fully independent,
// idempotent unit of work — designed to run as its own short HTTP request so
// a slow deep-dive generation for one interest can't threaten a serverless
// function's time limit for the others. The CLI script's all-at-once
// runDigestPipeline() (below) is built out of these same functions.
// ---------------------------------------------------------------------------

export interface NewsStepResult {
  interestId: number;
  interestName: string;
  added: number;
  fetched: number;
}

/** News for one interest: curated fetch if it has a source, else a generated Field News Roundup. */
export async function refreshNewsForInterest(interestId: number): Promise<NewsStepResult | null> {
  const interest = await getInterestById(interestId);
  if (!interest || !interest.enabled) return null;

  const cycleId = await getOrCreateCurrentCycleId();
  const result = await (interest.hasCuratedSource
    ? runCuratedNews(interest, cycleId)
    : runRoundupNews(interest, cycleId)
  ).catch((err) => {
    console.error(`[pipeline] News failed for "${interest.name}":`, err);
    return { added: 0, fetched: 0 };
  });

  if (result.added > 0) {
    await db.update(settings).set({ lastRefreshAt: new Date().toISOString() }).where(eq(settings.id, 1));
  }

  // Steelman companion: only for argument-central interests, capped per
  // cycle — see addSteelmansForInterest. Runs regardless of whether items
  // were just added, since it self-tops-up (idempotent) against whatever
  // this cycle already has.
  await addSteelmansForInterest(interest, cycleId).catch((err) => {
    console.error(`[pipeline] Steelman step failed for "${interest.name}":`, err);
  });

  return { interestId, interestName: interest.name, ...result };
}

export interface DeepDiveStepResult {
  interestId: number;
  interestName: string;
  added: boolean;
  topic: string | null;
}

interface DeepDivePersistResult {
  id: number;
  topic: string;
}

/**
 * Core deep-dive generation + persistence, shared by every path that writes
 * one: the automatic per-cycle step below, and every on-demand path
 * (curiosity branching, Passion Mode's Binge button, Passion Mode's pick-
 * your-next-topic) via generateOnDemandDeepDive. Generates the main entry,
 * then its follow-up topics and self-check questions (fast, no web_search —
 * run in parallel), then persists all three plus the covered-topics log
 * entry that schedules the first spaced review.
 */
async function generateAndPersistDeepDive(
  interest: InterestWithConfig,
  cycleId: number,
  opts: { forcedTopic?: string } = {}
): Promise<DeepDivePersistResult | null> {
  const covered = await getCoveredTopics(interest.id);
  // Passion Mode: favorited interests are framed one notch more advanced
  // than the interest's own stored level, without changing that setting.
  const level = interest.isFavorite ? bumpLevel(interest.level) : interest.level;
  const result = await generateDeepDive(interest.name, level, covered, opts.forcedTopic);
  if (!result) return null;

  // Explain-it-back essay prompt: only for advanced/research_level
  // interests, and only occasionally — see ESSAY_PROMPT_CHANCE. Uses the
  // covered-topics list already fetched above.
  const rollsEssayPrompt = ESSAY_PROMPT_LEVELS.includes(level) && Math.random() < ESSAY_PROMPT_CHANCE;

  const [followUps, selfCheck, essayPrompt] = await Promise.all([
    generateFollowUpTopics(interest.name, result.topic, result.content).catch((err) => {
      console.error(`[pipeline] Follow-up generation failed for "${interest.name}":`, err);
      return [];
    }),
    generateSelfCheckQuestions(interest.name, result.topic, result.content).catch((err) => {
      console.error(`[pipeline] Self-check generation failed for "${interest.name}":`, err);
      return [];
    }),
    rollsEssayPrompt
      ? generateEssayPrompt(interest.name, [...covered.recent, result.topic]).catch((err) => {
          console.error(`[pipeline] Essay prompt generation failed for "${interest.name}":`, err);
          return null;
        })
      : Promise.resolve(null),
  ]);

  const inserted = await db
    .insert(deepDives)
    .values({
      interestId: interest.id,
      topic: result.topic,
      content: result.content,
      sources: JSON.stringify(result.sources),
      level,
      digestId: cycleId,
      followUpTopics: JSON.stringify(followUps),
      selfCheckQuestions: JSON.stringify(selfCheck),
      essayPrompt,
    })
    .returning({ id: deepDives.id });

  const deepDiveId = inserted[0].id;
  await addCoveredTopic(interest.id, result.topic, deepDiveId);
  indexForSearch({
    contentType: "deep_dive",
    sourceId: deepDiveId,
    title: result.topic,
    body: result.content,
    interestLabel: interest.name,
    interestId: interest.id,
    date: new Date().toISOString(),
    url: `/deep-dive/${deepDiveId}`,
  }).catch((err) => console.error("[pipeline] search-index failed for deep dive:", err));
  return { id: deepDiveId, topic: result.topic };
}

/**
 * One Deep Dive for one interest, for the current cycle — no-op once this
 * cycle has reached its quota (1 normally, FAVORITE_DEEP_DIVE_QUOTA for a
 * favorited/Passion Mode interest). Called once per HTTP request; the
 * caller loops (see RefreshButton.tsx / runInterestCycle below) to fill a
 * >1 quota across multiple short requests rather than one long one.
 */
export async function refreshDeepDiveForInterest(interestId: number): Promise<DeepDiveStepResult | null> {
  const interest = await getInterestById(interestId);
  if (!interest || !interest.enabled) return null;
  if (!hasClaudeKey()) return { interestId, interestName: interest.name, added: false, topic: null };

  // Critical Thinking & Argumentation's primary content is Drills, not a
  // traditional syllogism-of-the-day deep dive — see refreshDrillsForCycle.
  // Skip the normal algorithm-picked deep dive entirely for this interest.
  if (interest.slug === "critical-thinking") {
    return { interestId, interestName: interest.name, added: false, topic: null };
  }

  const cycleId = await getOrCreateCurrentCycleId();
  const quota = interest.isFavorite ? FAVORITE_DEEP_DIVE_QUOTA : 1;
  const existing = await db
    .select({ topic: deepDives.topic })
    .from(deepDives)
    .where(and(eq(deepDives.interestId, interest.id), eq(deepDives.digestId, cycleId)));
  if (existing.length >= quota) {
    return {
      interestId,
      interestName: interest.name,
      added: false,
      topic: existing[existing.length - 1]?.topic ?? null,
    };
  }

  try {
    const result = await generateAndPersistDeepDive(interest, cycleId);
    if (!result) {
      console.error(`[pipeline] generateDeepDive returned null for "${interest.name}" — see [deepDive] log above.`);
      return { interestId, interestName: interest.name, added: false, topic: null };
    }
    return { interestId, interestName: interest.name, added: true, topic: result.topic };
  } catch (err) {
    console.error(`[pipeline] Deep dive failed for "${interest.name}":`, err);
    return { interestId, interestName: interest.name, added: false, topic: null };
  }
}

export interface ExplainBackResult {
  id: number;
  feedback: string;
}

/**
 * Live, on-demand user action (not part of any refresh cycle): the reader
 * submits their own-words explanation (or essay response) of a deep dive,
 * Claude gives brief supportive feedback, and both are stored. Returns null
 * if the dive doesn't exist, no key is configured, or generation fails.
 */
export async function submitExplainBack(deepDiveId: number, userExplanation: string): Promise<ExplainBackResult | null> {
  if (!hasClaudeKey()) return null;
  const trimmed = userExplanation.trim();
  if (!trimmed) return null;

  const diveRows = await db.select().from(deepDives).where(eq(deepDives.id, deepDiveId)).limit(1);
  const dive = diveRows[0];
  if (!dive) return null;

  const prompt = dive.essayPrompt || "Explain this back in your own words.";
  const feedback = await generateExplainBackFeedback(dive.topic, dive.content, prompt, trimmed);
  if (!feedback) return null;

  const inserted = await db
    .insert(explainBacks)
    .values({ deepDiveId, userExplanation: trimmed, feedback })
    .returning({ id: explainBacks.id });

  const interest = await getInterestById(dive.interestId);
  indexForSearch({
    contentType: "explain_back",
    sourceId: inserted[0].id,
    title: `Explain it back — ${dive.topic}`,
    body: `${trimmed}\n\n${feedback}`,
    interestLabel: interest?.name ?? "Unknown",
    interestId: dive.interestId,
    date: new Date().toISOString(),
    url: `/deep-dive/${deepDiveId}`,
  }).catch((err) => console.error("[pipeline] search-index failed for explain-back:", err));

  return { id: inserted[0].id, feedback };
}

/** Same as submitExplainBack, but for a Library book chapter's notebook
 * entry instead of a deep dive — the chapter's summary stands in for the
 * "original content", and there's no essay-prompt variant (chapters always
 * use the default "explain this back" framing). */
export async function submitChapterExplainBack(chapterId: number, userExplanation: string): Promise<ExplainBackResult | null> {
  if (!hasClaudeKey()) return null;
  const trimmed = userExplanation.trim();
  if (!trimmed) return null;

  const chapterRows = await db.select().from(bookChapters).where(eq(bookChapters.id, chapterId)).limit(1);
  const chapter = chapterRows[0];
  if (!chapter || !chapter.summary) return null;

  const feedback = await generateExplainBackFeedback(
    chapter.title,
    chapter.summary,
    "Explain this chapter back in your own words.",
    trimmed
  );
  if (!feedback) return null;

  const inserted = await db
    .insert(explainBacks)
    .values({ chapterId, userExplanation: trimmed, feedback })
    .returning({ id: explainBacks.id });

  const bookRows = await db.select({ title: books.title }).from(books).where(eq(books.id, chapter.bookId)).limit(1);
  indexForSearch({
    contentType: "explain_back",
    sourceId: inserted[0].id,
    title: `Explain it back — ${chapter.title}`,
    body: `${trimmed}\n\n${feedback}`,
    interestLabel: `Library: ${bookRows[0]?.title ?? "book"}`,
    interestId: null,
    date: new Date().toISOString(),
    url: `/library/chapter/${chapterId}`,
  }).catch((err) => console.error("[pipeline] search-index failed for chapter explain-back:", err));

  return { id: inserted[0].id, feedback };
}

export interface OnDemandDeepDiveResult {
  interestId: number;
  interestName: string;
  added: boolean;
  topic: string | null;
  deepDiveId: number | null;
}

/**
 * Generates one additional deep dive right now, outside the per-cycle
 * quota entirely — the shared mechanism behind curiosity branching
 * (forcedTopic = the follow-up card clicked), Passion Mode's Binge button
 * (no forcedTopic — algorithm picks), and Passion Mode's pick-your-next-
 * topic (forcedTopic = the chosen candidate). Works for any enabled
 * interest, not just favorited ones — branching isn't gated on favorite
 * status. Unlike the per-cycle step above, this is NOT idempotent-safe to
 * blindly retry: a retry generates another dive, not a no-op, so the UI
 * should disable the triggering button while a request is in flight.
 */
export async function generateOnDemandDeepDive(
  interestId: number,
  forcedTopic?: string
): Promise<OnDemandDeepDiveResult | null> {
  const interest = await getInterestById(interestId);
  if (!interest || !interest.enabled) return null;
  if (!hasClaudeKey()) {
    return { interestId, interestName: interest.name, added: false, topic: null, deepDiveId: null };
  }

  const cycleId = await getOrCreateCurrentCycleId();
  try {
    const result = await generateAndPersistDeepDive(interest, cycleId, { forcedTopic });
    if (!result) {
      return { interestId, interestName: interest.name, added: false, topic: null, deepDiveId: null };
    }

    if (interest.generatesAppliedInsights) {
      await generateInsightForDive(interest, result.id).catch((err) => {
        console.error(`[pipeline] On-demand applied insight failed for "${interest.name}":`, err);
      });
    }

    return { interestId, interestName: interest.name, added: true, topic: result.topic, deepDiveId: result.id };
  } catch (err) {
    console.error(`[pipeline] On-demand deep dive failed for "${interest.name}":`, err);
    return { interestId, interestName: interest.name, added: false, topic: null, deepDiveId: null };
  }
}

export interface InsightStepResult {
  interestId: number;
  interestName: string;
  added: boolean;
}

/** Generates + persists an Applied Insight for one specific deep dive, if the
 * interest generates them and one doesn't already exist for it. Shared by
 * the per-cycle step below (looped over the cycle's dives) and the on-demand
 * path above (a single freshly-written dive). Returns whether one was added. */
async function generateInsightForDive(interest: InterestWithConfig, deepDiveId: number): Promise<boolean> {
  const existingInsight = await db
    .select({ id: appliedInsights.id })
    .from(appliedInsights)
    .where(eq(appliedInsights.deepDiveId, deepDiveId))
    .limit(1);
  if (existingInsight.length > 0) return false;

  const diveRows = await db.select().from(deepDives).where(eq(deepDives.id, deepDiveId)).limit(1);
  const dive = diveRows[0];
  if (!dive) return false;

  const content = await generateAppliedInsight(interest.name, dive.topic, dive.content);
  if (!content) return false;

  const inserted = await db
    .insert(appliedInsights)
    .values({ interestId: interest.id, deepDiveId: dive.id, content })
    .returning({ id: appliedInsights.id });
  indexForSearch({
    contentType: "applied_insight",
    sourceId: inserted[0].id,
    title: `Applied Insight — ${interest.name}`,
    body: content,
    interestLabel: interest.name,
    interestId: interest.id,
    date: new Date().toISOString(),
    url: `/deep-dive/${dive.id}`,
  }).catch((err) => console.error("[pipeline] search-index failed for applied insight:", err));
  return true;
}

/** Same as generateInsightForDive, but grounded in a Drill instead of a
 * Deep Dive — for interests like Critical Thinking & Argumentation, whose
 * primary content is Drills, so most cycles have no deep dive to base an
 * Applied Insight on. */
async function generateInsightForDrill(interest: InterestWithConfig, drillId: number): Promise<boolean> {
  const existingInsight = await db
    .select({ id: appliedInsights.id })
    .from(appliedInsights)
    .where(eq(appliedInsights.drillId, drillId))
    .limit(1);
  if (existingInsight.length > 0) return false;

  const drillRows = await db.select().from(drills).where(eq(drills.id, drillId)).limit(1);
  const drill = drillRows[0];
  if (!drill) return false;

  const content = await generateAppliedInsight(
    interest.name,
    drill.conceptLabel,
    `${drill.promptContent}\n\nWhy this matters: ${drill.explanation}`
  );
  if (!content) return false;

  const inserted = await db
    .insert(appliedInsights)
    .values({ interestId: interest.id, drillId: drill.id, content })
    .returning({ id: appliedInsights.id });
  indexForSearch({
    contentType: "applied_insight",
    sourceId: inserted[0].id,
    title: `Applied Insight — ${interest.name}`,
    body: content,
    interestLabel: interest.name,
    interestId: interest.id,
    date: new Date().toISOString(),
    url: drill.digestId ? `/archive/${drill.digestId}` : "/drills",
  }).catch((err) => console.error("[pipeline] search-index failed for applied insight:", err));
  return true;
}

/** Applied Insights for every one of this cycle's deep dives for one interest
 * that don't have one yet — no-op if the interest doesn't generate them, has
 * no key configured, or has no dives yet this cycle. With Passion Mode's
 * multi-dive quota, a cycle can have more than one dive per interest, so
 * this loops rather than assuming just one. */
export async function refreshInsightForInterest(interestId: number): Promise<InsightStepResult | null> {
  const interest = await getInterestById(interestId);
  if (!interest || !interest.enabled) return null;
  if (!interest.generatesAppliedInsights || !hasClaudeKey()) {
    return { interestId, interestName: interest.name, added: false };
  }

  const cycleId = await getOrCreateCurrentCycleId();
  const diveRows = await db
    .select({ id: deepDives.id })
    .from(deepDives)
    .where(and(eq(deepDives.interestId, interest.id), eq(deepDives.digestId, cycleId)));
  if (diveRows.length === 0) return { interestId, interestName: interest.name, added: false };

  let anyAdded = false;
  for (const dive of diveRows) {
    try {
      if (await generateInsightForDive(interest, dive.id)) anyAdded = true;
    } catch (err) {
      console.error(`[pipeline] Applied insight failed for "${interest.name}" dive #${dive.id}:`, err);
    }
  }
  return { interestId, interestName: interest.name, added: anyAdded };
}

export interface DrillsStepResult {
  groundedAdded: number;
  standaloneAdded: boolean;
}

/**
 * Cycle-level Drills step (not per-interest, unlike the steps above) — run
 * once per cycle, after other interests' deep dives are generated, since
 * grounded drills scan across ALL interests' recent deep-dive content. Two
 * parts, each independently idempotent so a retry never duplicates:
 *  1. 1-2 drills grounded in a real, recent deep dive (any interest).
 *  2. 1 standalone formal-logic drill for Critical Thinking & Argumentation
 *     (preferred) or Logic, if either is enabled.
 */
export async function refreshDrillsForCycle(): Promise<DrillsStepResult> {
  if (!hasClaudeKey()) return { groundedAdded: 0, standaloneAdded: false };

  const cycleId = await getOrCreateCurrentCycleId();
  const existing = await db
    .select({ id: drills.id, sourceDeepDiveId: drills.sourceDeepDiveId })
    .from(drills)
    .where(eq(drills.digestId, cycleId));
  const existingGroundedCount = existing.filter((d) => d.sourceDeepDiveId !== null).length;
  const hasStandalone = existing.some((d) => d.sourceDeepDiveId === null);

  const groundedAdded =
    existingGroundedCount < GROUNDED_DRILL_TARGET
      ? await addGroundedDrills(cycleId, GROUNDED_DRILL_TARGET - existingGroundedCount)
      : 0;
  const standaloneAdded = hasStandalone ? false : await addStandaloneLogicDrill(cycleId);

  return { groundedAdded, standaloneAdded };
}

/** Formats a past Date to match SQLite's own `current_timestamp` shape, for
 * a lookback-window comparison against deepDives.createdAt. */
function daysAgoSqlite(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Scans recent deep dives (any interest) for extractable arguments, oldest-
 * excluded-first (already-drilled dives are skipped entirely — each dive
 * gets at most one grounded drill, ever), and attempts to build up to
 * `needed` drills from them. A dive with nothing extractable is simply
 * skipped (see generateGroundedDrill) rather than forcing a weak drill.
 */
async function addGroundedDrills(cycleId: number, needed: number): Promise<number> {
  if (needed <= 0) return 0;

  const alreadyDrilledRows = await db
    .select({ id: drills.sourceDeepDiveId })
    .from(drills)
    .where(isNotNull(drills.sourceDeepDiveId));
  const alreadyDrilledIds = new Set(alreadyDrilledRows.map((r) => r.id as number));

  const cutoff = daysAgoSqlite(GROUNDED_DRILL_LOOKBACK_DAYS);
  const recentDives = await db
    .select({
      id: deepDives.id,
      interestId: deepDives.interestId,
      topic: deepDives.topic,
      content: deepDives.content,
    })
    .from(deepDives)
    .where(gte(deepDives.createdAt, cutoff))
    .orderBy(desc(deepDives.createdAt))
    .limit(GROUNDED_DRILL_MAX_CANDIDATES + alreadyDrilledIds.size);

  const candidates = recentDives.filter((d) => !alreadyDrilledIds.has(d.id)).slice(0, GROUNDED_DRILL_MAX_CANDIDATES);

  let added = 0;
  for (const candidate of candidates) {
    if (added >= needed) break;
    const interest = await getInterestById(candidate.interestId);
    if (!interest) continue;

    try {
      const result = await generateGroundedDrill(interest.name, candidate.topic, candidate.content);
      if (!result) continue; // declined — nothing extractable in this dive

      const inserted = await db
        .insert(drills)
        .values({
          interestId: candidate.interestId,
          sourceDeepDiveId: candidate.id,
          drillType: result.drillType,
          promptContent: result.promptContent,
          options: JSON.stringify(result.options),
          correctOption: result.correctOption,
          explanation: result.explanation,
          conceptLabel: result.conceptLabel,
          digestId: cycleId,
        })
        .returning({ id: drills.id });

      await addCoveredTopic(candidate.interestId, result.conceptLabel, candidate.id);
      indexForSearch({
        contentType: "drill",
        sourceId: inserted[0].id,
        title: `Drill — ${result.conceptLabel}`,
        body: `${result.promptContent}\n\n${result.explanation}`,
        interestLabel: interest.name,
        interestId: interest.id,
        date: new Date().toISOString(),
        url: "/drills",
      }).catch((err) => console.error("[pipeline] search-index failed for drill:", err));
      if (interest.generatesAppliedInsights) {
        await generateInsightForDrill(interest, inserted[0].id).catch((err) => {
          console.error(`[pipeline] Grounded-drill applied insight failed for "${interest.name}":`, err);
        });
      }
      added++;
    } catch (err) {
      console.error(`[pipeline] Grounded drill generation failed for dive #${candidate.id}:`, err);
    }
  }
  return added;
}

/**
 * One standalone formal-logic drill (no source deep dive), attached to
 * Critical Thinking & Argumentation if enabled, else Logic if enabled, else
 * skipped — no point generating pure logic drills if neither is tracked.
 * The two interests share drill material: the "avoid repeating" list pools
 * covered topics from both rather than treating them as separate tracks.
 */
async function addStandaloneLogicDrill(cycleId: number): Promise<boolean> {
  const [criticalThinking, logic] = await Promise.all([
    getInterestBySlug("critical-thinking"),
    getInterestBySlug("logic"),
  ]);
  const targetInterest = criticalThinking?.enabled ? criticalThinking : logic?.enabled ? logic : null;
  if (!targetInterest) return false;

  try {
    const [ctCovered, logicCovered] = await Promise.all([
      criticalThinking ? getCoveredTopics(criticalThinking.id) : null,
      logic ? getCoveredTopics(logic.id) : null,
    ]);
    const avoidConcepts = [...(ctCovered?.recent ?? []), ...(logicCovered?.recent ?? [])];

    const result = await generateStandaloneLogicDrill(avoidConcepts);
    if (!result) return false;

    const inserted = await db
      .insert(drills)
      .values({
        interestId: targetInterest.id,
        sourceDeepDiveId: null,
        drillType: result.drillType,
        promptContent: result.promptContent,
        options: JSON.stringify(result.options),
        correctOption: result.correctOption,
        explanation: result.explanation,
        conceptLabel: result.conceptLabel,
        digestId: cycleId,
      })
      .returning({ id: drills.id });

    await addCoveredTopic(targetInterest.id, result.conceptLabel, null);
    indexForSearch({
      contentType: "drill",
      sourceId: inserted[0].id,
      title: `Drill — ${result.conceptLabel}`,
      body: `${result.promptContent}\n\n${result.explanation}`,
      interestLabel: targetInterest.name,
      interestId: targetInterest.id,
      date: new Date().toISOString(),
      url: "/drills",
    }).catch((err) => console.error("[pipeline] search-index failed for standalone drill:", err));
    if (targetInterest.generatesAppliedInsights) {
      await generateInsightForDrill(targetInterest, inserted[0].id).catch((err) => {
        console.error(`[pipeline] Standalone-drill applied insight failed for "${targetInterest.name}":`, err);
      });
    }
    return true;
  } catch (err) {
    console.error("[pipeline] Standalone logic drill generation failed:", err);
    return false;
  }
}

/**
 * Cycle-level Mental Model of the Day step — picks one mental model not
 * used recently, gathers today's fetched items across enabled interests,
 * and asks Claude to connect the model to one or two of them concretely.
 * Idempotent: no-ops if this cycle already has one. Declines (no row
 * added) if nothing today fits any recently-unused model naturally.
 */
export async function refreshMentalModelForCycle(): Promise<boolean> {
  if (!hasClaudeKey()) return false;

  const cycleId = await getOrCreateCurrentCycleId();
  const existing = await db.select({ id: modelUsage.id }).from(modelUsage).where(eq(modelUsage.digestId, cycleId)).limit(1);
  if (existing.length > 0) return false;

  // Not gated on enabledInterests.length: a Library book's chapters (below)
  // are eligible candidates independent of whether any interest is enabled.
  const enabledInterests = await getEnabledInterests();
  const interestNameById = new Map(enabledInterests.map((i) => [i.id, i.name]));

  const itemRows = await db
    .select({ id: items.id, title: items.title, summary: items.summary, interestId: items.interestId })
    .from(items)
    .where(eq(items.digestId, cycleId))
    .orderBy(desc(items.score))
    .limit(MENTAL_MODEL_ITEM_CANDIDATES);
  const itemCandidates = itemRows
    .filter((r) => r.interestId != null && interestNameById.has(r.interestId))
    .map((r) => ({
      title: r.title,
      summary: r.summary,
      interestName: interestNameById.get(r.interestId!)!,
      ref: { type: "item" as const, id: r.id },
    }));

  // Library chapters surfaced THIS cycle are eligible too, same as any
  // interest content — see refreshBookChapterForCycle, which runs before
  // this step (both are called from the same cycle-steps sequence).
  const chapterRows = await db
    .select({ id: bookChapters.id, title: bookChapters.title, summary: bookChapters.summary, bookId: bookChapters.bookId })
    .from(bookChapters)
    .where(and(eq(bookChapters.digestId, cycleId), isNotNull(bookChapters.summary)));
  const bookTitleById = new Map<number, string>();
  for (const row of chapterRows) {
    if (!bookTitleById.has(row.bookId)) {
      const b = await db.select({ title: books.title }).from(books).where(eq(books.id, row.bookId)).limit(1);
      bookTitleById.set(row.bookId, b[0]?.title ?? "Library book");
    }
  }
  const chapterCandidates = chapterRows.map((r) => ({
    title: r.title,
    summary: r.summary ?? "",
    interestName: `Library: ${bookTitleById.get(r.bookId) ?? "book"}`,
    ref: { type: "chapter" as const, id: r.id },
  }));

  const merged = [...itemCandidates, ...chapterCandidates];
  const candidates = merged.map((c, idx) => ({ index: idx + 1, ...c }));
  if (candidates.length === 0) return false;

  // Recently-used models (by most recent dateUsed), excluded from selection
  // so the feature doesn't repeat the same lens over and over.
  const recentUsageRows = await db
    .select({ modelId: modelUsage.modelId })
    .from(modelUsage)
    .orderBy(desc(modelUsage.dateUsed))
    .limit(MODEL_USAGE_LOOKBACK);
  const recentlyUsedIds = recentUsageRows.map((r) => r.modelId);

  const availableModels =
    recentlyUsedIds.length > 0
      ? await db.select().from(mentalModels).where(notInArray(mentalModels.id, recentlyUsedIds))
      : await db.select().from(mentalModels);
  const pool = availableModels.length > 0 ? availableModels : await db.select().from(mentalModels);
  if (pool.length === 0) return false;

  // Try a few random models (not just one) in case the first pick doesn't
  // cleanly apply to today's actual items — generateMentalModelLens
  // declines rather than forcing a strained connection.
  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);

  for (const model of shuffled) {
    try {
      const lens = await generateMentalModelLens(
        model.name,
        model.description,
        candidates.map(({ index, title, summary, interestName }) => ({ index, title, summary, interestName }))
      );
      if (!lens) continue;

      const linkedItemIds: LinkedItemRef[] = lens.usedIndexes
        .map((i) => candidates.find((c) => c.index === i)?.ref)
        .filter((ref): ref is LinkedItemRef => ref != null);
      if (linkedItemIds.length === 0) continue;

      const insertedUsage = await db
        .insert(modelUsage)
        .values({
          modelId: model.id,
          digestId: cycleId,
          linkedItemIds: JSON.stringify(linkedItemIds),
          lensText: lens.lensText,
        })
        .returning({ id: modelUsage.id });
      indexForSearch({
        contentType: "mental_model",
        sourceId: insertedUsage[0].id,
        title: `Mental Model: ${model.name}`,
        body: lens.lensText,
        interestLabel: "Mental Model of the Day",
        interestId: null,
        date: new Date().toISOString(),
        url: `/archive/${cycleId}?at=mentalmodel-${insertedUsage[0].id}`,
      }).catch((err) => console.error("[pipeline] search-index failed for mental model usage:", err));
      return true;
    } catch (err) {
      console.error(`[pipeline] Mental model lens failed for "${model.name}":`, err);
    }
  }
  return false;
}

/**
 * Cycle-level Rabbit Hole of the Day step — one item entirely outside the
 * reader's active interests, via web search. Idempotent: no-ops if this
 * cycle already has one.
 */
export async function refreshRabbitHoleForCycle(): Promise<boolean> {
  if (!hasClaudeKey()) return false;

  const cycleId = await getOrCreateCurrentCycleId();
  const existing = await db.select({ id: rabbitHoles.id }).from(rabbitHoles).where(eq(rabbitHoles.digestId, cycleId)).limit(1);
  if (existing.length > 0) return false;

  const enabledInterests = await getEnabledInterests();
  const activeNames = enabledInterests.map((i) => i.name);

  const recentRows = await db
    .select({ topicArea: rabbitHoles.topicArea })
    .from(rabbitHoles)
    .orderBy(desc(rabbitHoles.createdAt))
    .limit(RABBIT_HOLE_AVOID_LOOKBACK);
  const avoidTopics = recentRows.map((r) => r.topicArea);

  try {
    const result = await generateRabbitHole(activeNames, avoidTopics);
    if (!result) return false;

    const insertedHole = await db
      .insert(rabbitHoles)
      .values({
        title: result.title,
        summary: result.summary,
        url: result.url,
        sourceName: result.sourceName,
        topicArea: result.topicArea,
        digestId: cycleId,
      })
      .returning({ id: rabbitHoles.id });
    indexForSearch({
      contentType: "rabbit_hole",
      sourceId: insertedHole[0].id,
      title: result.title,
      body: result.summary,
      interestLabel: result.topicArea,
      interestId: null,
      date: new Date().toISOString(),
      url: `/archive/${cycleId}?at=rabbithole-${insertedHole[0].id}`,
    }).catch((err) => console.error("[pipeline] search-index failed for rabbit hole:", err));
    return true;
  } catch (err) {
    console.error("[pipeline] Rabbit hole generation failed:", err);
    return false;
  }
}

export interface BookChapterStepResult {
  chaptersSurfaced: number;
}

/**
 * Cycle-level Library drip-feed step: for every "ready" book, surfaces its
 * next pace_chapters_per_cycle pending chapters this cycle (idempotent —
 * tops up to the pace target, so a retry never surfaces extras), then for
 * each newly-surfaced chapter: logs its key concepts into covered_topics
 * under that book's hidden pseudo-interest (feeding the existing spaced-
 * resurfacing system) and attempts one grounded drill from its
 * notable_arguments (reusing Phase 5's generateGroundedDrill, same
 * "decline rather than force" contract). Processing (Claude reading the
 * PDF) already happened at upload time — this step only governs *when* an
 * already-written chapter becomes visible.
 */
export async function refreshBookChapterForCycle(): Promise<BookChapterStepResult> {
  const cycleId = await getOrCreateCurrentCycleId();
  const readyBooks = await db.select().from(books).where(eq(books.status, "ready"));
  if (readyBooks.length === 0) return { chaptersSurfaced: 0 };

  let chaptersSurfaced = 0;
  for (const book of readyBooks) {
    try {
      const alreadyThisCycle = await db
        .select({ id: bookChapters.id })
        .from(bookChapters)
        .where(and(eq(bookChapters.bookId, book.id), eq(bookChapters.digestId, cycleId)));
      const needed = book.paceChaptersPerCycle - alreadyThisCycle.length;
      if (needed <= 0) continue;

      const pending = await db
        .select()
        .from(bookChapters)
        .where(and(eq(bookChapters.bookId, book.id), eq(bookChapters.status, "pending"), isNotNull(bookChapters.summary)))
        .orderBy(bookChapters.chapterNumber)
        .limit(needed);
      if (pending.length === 0) continue;

      const libraryInterest = await getOrCreateLibraryInterest(book.id, book.title);

      for (const chapter of pending) {
        await db
          .update(bookChapters)
          .set({ status: "surfaced", digestId: cycleId })
          .where(eq(bookChapters.id, chapter.id));
        chaptersSurfaced++;

        let keyConcepts: { term: string; definition: string }[] = [];
        let notableArguments: string[] = [];
        try {
          keyConcepts = JSON.parse(chapter.keyConcepts);
        } catch {
          keyConcepts = [];
        }
        try {
          notableArguments = JSON.parse(chapter.notableArguments);
        } catch {
          notableArguments = [];
        }

        for (const concept of keyConcepts) {
          await addCoveredTopicFromChapter(libraryInterest.id, concept.term, chapter.id).catch((err) => {
            console.error(`[pipeline] Covered-topic logging failed for chapter #${chapter.id}:`, err);
          });
        }

        if (notableArguments.length > 0 && chapter.summary) {
          try {
            const groundingContent = `${chapter.summary}\n\nArguments this chapter makes:\n${notableArguments
              .map((a) => `- ${a}`)
              .join("\n")}`;
            const drillResult = await generateGroundedDrill(libraryInterest.name, chapter.title, groundingContent);
            if (drillResult) {
              const insertedChapterDrill = await db
                .insert(drills)
                .values({
                  interestId: libraryInterest.id,
                  sourceChapterId: chapter.id,
                  drillType: drillResult.drillType,
                  promptContent: drillResult.promptContent,
                  options: JSON.stringify(drillResult.options),
                  correctOption: drillResult.correctOption,
                  explanation: drillResult.explanation,
                  conceptLabel: drillResult.conceptLabel,
                  digestId: cycleId,
                })
                .returning({ id: drills.id });
              indexForSearch({
                contentType: "drill",
                sourceId: insertedChapterDrill[0].id,
                title: `Drill — ${drillResult.conceptLabel}`,
                body: `${drillResult.promptContent}\n\n${drillResult.explanation}`,
                interestLabel: libraryInterest.name,
                interestId: libraryInterest.id,
                date: new Date().toISOString(),
                url: "/drills",
              }).catch((err) => console.error("[pipeline] search-index failed for chapter drill:", err));
            }
          } catch (err) {
            console.error(`[pipeline] Chapter-grounded drill failed for chapter #${chapter.id}:`, err);
          }
        }
      }
    } catch (err) {
      console.error(`[pipeline] Book chapter drip-feed failed for book #${book.id}:`, err);
    }
  }

  return { chaptersSurfaced };
}

/**
 * Steelman companion: for interests where argument is central (a fixed
 * slug list, plus any custom interest), generates up to
 * STEELMAN_TARGET_PER_INTEREST counterarguments per cycle for this
 * interest's freshly-fetched items that present a genuine arguable thesis.
 * One combined Claude call (with web_search) covers up to
 * STEELMAN_CANDIDATE_POOL candidates, rather than one call per item, to
 * bound cost. Idempotent: only tops up to the per-cycle target, so a retry
 * never re-generates items that already have one.
 */
async function addSteelmansForInterest(interest: InterestWithConfig, cycleId: number): Promise<number> {
  if (!hasClaudeKey()) return 0;
  const eligible = STEELMAN_ELIGIBLE_SLUGS.has(interest.slug) || interest.isCustom;
  if (!eligible) return 0;

  const existingCount = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.interestId, interest.id), eq(items.digestId, cycleId), isNotNull(items.steelmanContent)));
  const needed = STEELMAN_TARGET_PER_INTEREST - existingCount.length;
  if (needed <= 0) return 0;

  const candidateRows = await db
    .select({ id: items.id, title: items.title, summary: items.summary })
    .from(items)
    .where(and(eq(items.interestId, interest.id), eq(items.digestId, cycleId), isNull(items.steelmanContent)))
    .orderBy(desc(items.score))
    .limit(STEELMAN_CANDIDATE_POOL);
  if (candidateRows.length === 0) return 0;

  try {
    const results = await generateSteelmans(
      interest.name,
      candidateRows.map((c, idx) => ({ index: idx + 1, title: c.title, summary: c.summary }))
    );

    let added = 0;
    for (const r of results) {
      if (added >= needed) break;
      const candidate = candidateRows[r.index - 1];
      if (!candidate) continue;
      await db.update(items).set({ steelmanContent: r.steelman }).where(eq(items.id, candidate.id));
      added++;
    }
    return added;
  } catch (err) {
    console.error(`[pipeline] Steelman generation failed for "${interest.name}":`, err);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// All-at-once pipeline — used by the standalone `npm run fetch` CLI script,
// which runs locally with no HTTP function time limit. The web UI instead
// calls the three granular functions above once per interest (see
// RefreshButton.tsx) so no single request risks a serverless timeout.
// ---------------------------------------------------------------------------

/**
 * Runs the full pipeline for one refresh: for every enabled interest, in
 * parallel — fetches/generates that interest's News, generates one Deep
 * Dive if this cycle doesn't already have one, and (if applicable) one
 * Applied Insight off that deep dive. Every interest is fully isolated: one
 * failing never blocks the others.
 */
export async function runDigestPipeline(): Promise<PipelineResult> {
  const cycleId = await getOrCreateCurrentCycleId();
  const enabledInterests = await getEnabledInterests();

  if (enabledInterests.length === 0) {
    // Library books are read independently of the interests system — still
    // drip-feed a chapter even if the reader has no interests enabled.
    const bookChapterResult = await refreshBookChapterForCycle().catch((err) => {
      console.error("[pipeline] Book chapter drip-feed step failed:", err);
      return { chaptersSurfaced: 0 };
    });
    return {
      cycleId,
      newsAdded: 0,
      deepDivesAdded: 0,
      appliedInsightsAdded: 0,
      drillsAdded: 0,
      mentalModelAdded: false,
      rabbitHoleAdded: false,
      chaptersSurfaced: bookChapterResult.chaptersSurfaced,
      fetchedCount: 0,
      usedClaude: hasClaudeKey(),
      newBrainFacts: 0,
      enabledInterestCount: 0,
    };
  }

  const results = await Promise.all(enabledInterests.map((interest) => runInterestCycle(interest)));

  // Drills and Mental Model both scan across ALL interests' fresh content,
  // so they run once, after every interest's News/Deep Dive/Applied Insight
  // steps above have settled. Rabbit Hole doesn't depend on that content
  // but is cycle-level too, so it runs alongside them. Book chapters run
  // BEFORE Mental Model specifically, since a chapter surfaced this cycle
  // is only eligible as a lens candidate once it's actually surfaced.
  const bookChapterResult = await refreshBookChapterForCycle().catch((err) => {
    console.error("[pipeline] Book chapter drip-feed step failed:", err);
    return { chaptersSurfaced: 0 };
  });
  const drillsResult = await refreshDrillsForCycle().catch((err) => {
    console.error("[pipeline] Drills step failed:", err);
    return { groundedAdded: 0, standaloneAdded: false };
  });
  const mentalModelAdded = await refreshMentalModelForCycle().catch((err) => {
    console.error("[pipeline] Mental model step failed:", err);
    return false;
  });
  const rabbitHoleAdded = await refreshRabbitHoleForCycle().catch((err) => {
    console.error("[pipeline] Rabbit hole step failed:", err);
    return false;
  });

  const newBrainFacts = await maybeGenerateWeeklyFacts().catch((err) => {
    console.error("[pipeline] weekly brain fact generation failed:", err);
    return 0;
  });

  return {
    cycleId,
    newsAdded: results.reduce((sum, r) => sum + r.newsAdded, 0),
    deepDivesAdded: results.filter((r) => r.deepDiveAdded).length,
    appliedInsightsAdded: results.filter((r) => r.insightAdded).length,
    drillsAdded: drillsResult.groundedAdded + (drillsResult.standaloneAdded ? 1 : 0),
    mentalModelAdded,
    rabbitHoleAdded,
    chaptersSurfaced: bookChapterResult.chaptersSurfaced,
    fetchedCount: results.reduce((sum, r) => sum + r.fetched, 0),
    usedClaude: hasClaudeKey(),
    newBrainFacts,
    enabledInterestCount: enabledInterests.length,
  };
}

/** News + Deep Dive(s) + Applied Insight(s) for one interest, built from the
 * granular step functions above. Loops the deep-dive step to fill a
 * favorited interest's full per-cycle quota (>1) — safe because
 * refreshDeepDiveForInterest no-ops once quota is reached, so the loop just
 * stops early for a non-favorited (quota 1) interest. */
async function runInterestCycle(interest: InterestWithConfig): Promise<InterestCycleResult> {
  const news = await refreshNewsForInterest(interest.id);

  let deepDiveAdded = false;
  for (let i = 0; i < FAVORITE_DEEP_DIVE_QUOTA; i++) {
    const dive = await refreshDeepDiveForInterest(interest.id);
    if (dive?.added) deepDiveAdded = true;
    else break;
  }

  const insight = await refreshInsightForInterest(interest.id);
  return {
    newsAdded: news?.added ?? 0,
    fetched: news?.fetched ?? 0,
    deepDiveAdded,
    insightAdded: insight?.added ?? false,
  };
}

/** Dedupes a batch against everything already persisted, returning only genuinely new items. */
async function filterFresh(rawItems: RawItem[]): Promise<RawItem[]> {
  const deduped = dedupeItems(rawItems);
  const existingKeysResult = await client.execute("SELECT dedupe_key FROM items");
  const existingKeys = new Set(existingKeysResult.rows.map((r: any) => r.dedupe_key as string));
  return deduped.filter((item) => !existingKeys.has(dedupeKeyFor(item)));
}

/** Inserts processed items one at a time, skipping (not aborting the batch on) a rare dedupe-key race. */
async function insertItems(
  processed: ProcessedItem[],
  interestId: number,
  interestName: string,
  cycleId: number
): Promise<number> {
  let inserted = 0;
  for (const item of processed) {
    try {
      const row = await db
        .insert(items)
        .values({
          title: item.title,
          authors: item.authors,
          summary: item.summary,
          rawSnippet: item.snippet,
          sourceName: item.sourceName,
          sourceType: item.sourceType,
          category: item.category,
          interestId,
          url: item.url,
          dedupeKey: item.dedupeKey,
          publishedAt: item.publishedAt,
          score: item.score,
          digestId: cycleId,
        })
        .returning({ id: items.id });
      inserted++;
      indexForSearch({
        contentType: "news",
        sourceId: row[0].id,
        title: item.title,
        body: item.summary,
        interestLabel: interestName,
        interestId,
        date: item.publishedAt ?? new Date().toISOString(),
        url: `/archive/${cycleId}?at=news-${row[0].id}`,
      }).catch((err) => console.error("[pipeline] search-index failed for news item:", err));
    } catch (err) {
      console.error(`[pipeline] Skipping item insert (likely a dedupe race) for "${item.title}":`, err);
    }
  }
  return inserted;
}

/**
 * News for a hasCuratedSource=true interest: fetch its registered RSS/API
 * source(s). Scores and picks the top TARGET_ITEMS_PER_INTEREST candidates
 * on cheap, Claude-free heuristics (scoreItem — recency/length/source type)
 * *before* calling Claude, and only summarizes/categorizes that shortlist.
 * A curated fetch can return 100+ fresh items on a busy day; summarizing
 * all of them just to keep 8 wasted API calls and, worse, could push this
 * step's latency past a serverless function's time limit for no benefit —
 * the discarded items' summaries are never seen.
 */
async function runCuratedNews(
  interest: InterestWithConfig,
  cycleId: number
): Promise<{ added: number; fetched: number }> {
  const rawItems = await fetchForInterest(interest.slug);
  const fetchedCount = rawItems.length;
  if (fetchedCount === 0) return { added: 0, fetched: 0 };

  const fresh = await filterFresh(rawItems);
  if (fresh.length === 0) return { added: 0, fetched: fetchedCount };

  const candidates = fresh
    .map((item) => ({ item, score: scoreItem(item) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TARGET_ITEMS_PER_INTEREST);

  // Neuroscience keeps the legacy 4-category classifier; every other
  // curated interest just gets a plain summary (no forced category).
  const isNeuro = interest.slug === "neuroscience";
  const items_ = candidates.map((c) => c.item);
  // Phase 10: summarize from a real abstract or a fetched article page
  // (see buildSummaryTexts), not the thin RSS/API snippet directly — the
  // original items_ (and their short snippets) are untouched for
  // scoring/rawSnippet/cleanSummary-fallback purposes below.
  const summaryTexts = await buildSummaryTexts(items_);
  const itemsForSummary = items_.map((item, i) => ({ ...item, snippet: summaryTexts[i] }));
  const neuroResults = isNeuro ? await classifyAndSummarizeBatch(itemsForSummary) : null;
  const otherResults = isNeuro ? null : await summarizeBatch(itemsForSummary);

  const processed: ProcessedItem[] = candidates.map(({ item, score }, idx) => {
    let category: Category | null = null;
    let summary: string;
    if (neuroResults) {
      const r = neuroResults.get(idx);
      category = r?.category ?? categorizeByKeywords(item);
      summary = cleanSummary(r?.summary, item.snippet);
    } else {
      summary = cleanSummary(otherResults?.get(idx), item.snippet);
    }
    return { ...item, category, summary, score, dedupeKey: dedupeKeyFor(item) };
  });

  const added = await insertItems(processed, interest.id, interest.name, cycleId);
  return { added, fetched: fetchedCount };
}

// Critical Thinking & Argumentation's News Roundup targets real arguments/
// fallacies in circulation specifically, rather than generic "developments
// in critical thinking" commentary — see newsRoundup.ts's focusOverride.
const ROUNDUP_FOCUS_OVERRIDES: Record<string, string> = {
  "critical-thinking":
    "real arguments, claims, or pieces of reasoning currently circulating in public discourse or " +
    "media (op-eds, punditry, marketing claims, political rhetoric, viral social posts, etc.) that " +
    "would make good critical-thinking practice material — not just general commentary about " +
    "critical thinking as a topic",
};

/**
 * News for an interest with no registered fetcher (any custom interest,
 * Business/Political Science/Philosophy of Science, or Critical Thinking &
 * Argumentation): a Claude-generated, web-search-grounded Field News
 * Roundup. Items arrive with a short 2-3 sentence summary from the roundup
 * generation itself (see newsRoundup.ts) — Phase 10 fetches each item's
 * real linked article page and re-summarizes from that fuller content into
 * the same ~120-200 word abstract-style target as every other News source,
 * falling back to the roundup's own inline summary if that fetch fails.
 */
async function runRoundupNews(
  interest: InterestWithConfig,
  cycleId: number
): Promise<{ added: number; fetched: number }> {
  if (!hasClaudeKey()) return { added: 0, fetched: 0 };

  const rawItems = await generateFieldNewsRoundup(interest.name, ROUNDUP_FOCUS_OVERRIDES[interest.slug]);
  const fetchedCount = rawItems.length;
  if (fetchedCount === 0) return { added: 0, fetched: 0 };

  const fresh = await filterFresh(rawItems);
  if (fresh.length === 0) return { added: 0, fetched: fetchedCount };

  const summaryTexts = await buildSummaryTexts(fresh);
  const itemsForSummary = fresh.map((item, i) => ({ ...item, snippet: summaryTexts[i] }));
  const roundupResults = await summarizeBatch(itemsForSummary);

  const processed: ProcessedItem[] = fresh.map((item, idx) => ({
    ...item,
    category: null,
    summary: cleanSummary(roundupResults.get(idx), item.snippet),
    score: scoreItem(item),
    dedupeKey: dedupeKeyFor(item),
  }));

  processed.sort((a, b) => b.score - a.score);
  const selected = processed.slice(0, TARGET_ROUNDUP_ITEMS);
  const added = await insertItems(selected, interest.id, interest.name, cycleId);
  return { added, fetched: fetchedCount };
}

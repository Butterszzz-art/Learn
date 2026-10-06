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
import type { Category, Level, PrunableContentType } from "@/db/schema";
import { bumpLevel } from "@/db/schema";
import { eq, and, gte, lte, desc, isNotNull, isNull, notInArray, inArray } from "drizzle-orm";
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
import { isAutoGenerationEnabled } from "./engagement";
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
import { getSyllabusContext } from "./syllabus";

export const TARGET_ITEMS_PER_INTEREST = 8; // curated (RSS/API) sources
export const TARGET_ROUNDUP_ITEMS = 5; // generated Field News Roundup
// Phase 13 (Hybrid Cadence): Field News Roundup items are the one "stays
// daily" content type that costs meaningfully more per call than a curated-
// source item (a fresh web_search every time, vs. an RSS/API fetch). Flip
// this to "weekly" if that cost becomes a real concern — everything else
// about runRoundupNews keeps working unchanged, it'll just attach to the
// weekly cycle instead of the daily one.
const ROUNDUP_ITEMS_CADENCE: "daily" | "weekly" = "daily";
// Passion Mode: favorited interests get this many deep dives per WEEK
// instead of 1 (Phase 13 moved Deep Dives from daily to weekly — was
// FAVORITE_DEEP_DIVE_QUOTA=2/day, i.e. up to ~14/week; now capped at the
// spec's "2-3 per week, not 7").
export const WEEKLY_DEEP_DIVE_QUOTA_NORMAL = 1;
export const WEEKLY_DEEP_DIVE_QUOTA_FAVORITE = 3;
// Drills (Phase 5, moved weekly in Phase 13): "1-2 drills" grounded in real
// recent deep-dive content per cycle (now a week), scanned across ALL
// interests. Lookback widened from 4 to 10 days so a whole week's worth of
// (now less frequent) deep dives stays in the candidate pool.
export const GROUNDED_DRILL_TARGET = 2;
export const GROUNDED_DRILL_LOOKBACK_DAYS = 10;
export const GROUNDED_DRILL_MAX_CANDIDATES = 5; // bounds Claude calls even with a large recent-dive pool

// Phase 6 constants.
// Explain-it-back: for advanced/research_level interests, roughly 1 in 7
// deep dives gets a real essay-style open question instead of the default
// "explain this back" prompt — matches the spec's "roughly weekly" cadence;
// now that deep dives themselves are weekly (Phase 13), this rolls per dive
// rather than per day, so it's rarer in practice, which is fine — an essay
// prompt was always meant to be an occasional variant, not a fixed schedule.
export const ESSAY_PROMPT_CHANCE = 1 / 7;
export const ESSAY_PROMPT_LEVELS: Level[] = ["advanced", "research_level"];
// Mental Model of the Week (Phase 13: 2-3/week instead of 1/day): how many
// recent usages to look back on when picking an unused-recently model, how
// many of the week's items to offer as candidates, and the per-week target.
export const MODEL_USAGE_LOOKBACK = 15;
export const MENTAL_MODEL_ITEM_CANDIDATES = 12;
export const MENTAL_MODEL_WEEKLY_TARGET = 3;
// Steelman: only for interests where argument is central, capped per WEEK
// (Phase 13 — was per day) to control API cost (each generation call uses
// web_search).
export const STEELMAN_ELIGIBLE_SLUGS = new Set(["political-science", "economics", "philosophy", "critical-thinking"]);
export const STEELMAN_TARGET_PER_INTEREST = 2;
export const STEELMAN_CANDIDATE_POOL = 8;
// Rabbit Hole of the Week (Phase 13: 1-2/week instead of 1/day): how many
// recently-shown topic areas to avoid repeating, and the per-week target.
export const RABBIT_HOLE_AVOID_LOOKBACK = 20;
export const RABBIT_HOLE_WEEKLY_TARGET = 2;

// Phase 7 (Library) — modelUsage.linkedItemIds entry shape. Widened from
// Phase 6's plain number[] to also reference a book chapter, not just a
// News item.
type LinkedItemRef = { type: "item" | "chapter"; id: number };

export interface PipelineResult {
  // Phase 13: both cadences always run — the daily cycle carries News, the
  // weekly cycle carries everything else.
  dailyCycleId: number;
  weeklyCycleId: number;
  newsAdded: number;
  deepDivesAdded: number;
  appliedInsightsAdded: number;
  drillsAdded: number;
  steelmansAdded: number;
  mentalModelsAdded: number;
  rabbitHolesAdded: number;
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
  steelmansAdded: number;
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

export function cleanSummary(summary: string | undefined | null, fallbackSnippet: string): string {
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
export async function buildSummaryTexts(items: RawItem[]): Promise<string[]> {
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

// ---------------------------------------------------------------------------
// Phase 13 (Hybrid Cadence): a daily cycle and a weekly cycle now both
// always exist concurrently — no user toggle. Cheap, mostly-compressing-
// existing-material content (News, Field News Roundup by default) attaches
// to the daily cycle; everything substantial (Deep Dives, Applied Insights,
// Drills, Mental Model, Rabbit Hole, Library chapters, Brain Games, Steelman)
// attaches to the weekly cycle. `digests.frequency`/`periodLabel` already
// distinguish the two — no new column needed on any content table.
// ---------------------------------------------------------------------------

function dailyPeriodLabel(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/** The most recent Monday, as YYYY-MM-DD (UTC). */
function currentWeekMondayLabel(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - diffToMonday);
  return monday.toISOString().slice(0, 10);
}

function weeklyPeriodLabel(): string {
  return `Week of ${currentWeekMondayLabel()}`;
}

/**
 * Finds the digest ("cycle") row for the given period, or creates one.
 * Multiple refreshes within the same day/week accumulate into the SAME
 * cycle — this is what makes the "You're caught up" bounded feed meaningful.
 */
async function findOrCreateCycle(frequency: "daily" | "weekly", label: string): Promise<number> {
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
 * Resolves the current DAILY cycle id, creating it (with its Brain Fact) if
 * this is the first call today. Idempotent and cheap — safe to call once per
 * step, per interest, per HTTP request; this is what lets the granular
 * refreshXForInterest functions below be fully self-contained. News and
 * (by default) Field News Roundup attach here.
 */
export async function getOrCreateDailyCycleId(): Promise<number> {
  return ensureCycleHasBrainFact(await findOrCreateCycle("daily", dailyPeriodLabel()));
}

/**
 * Resolves the current WEEKLY cycle id, creating it if this is the first
 * call this week. Deep Dives, Applied Insights, Drills, Mental Model,
 * Rabbit Hole, Library chapters, Brain Games, and Steelman all attach here —
 * the consolidated "This Week in [Interest]" bundle.
 */
export async function getOrCreateWeeklyCycleId(): Promise<number> {
  return findOrCreateCycle("weekly", weeklyPeriodLabel());
}

/**
 * Every daily-cadence digest id created so far THIS week (Monday through
 * today) — used by weekly steps that need to scan the whole week's daily-
 * cadence content (Steelman candidates, Mental Model candidates), not just
 * a single day's. String comparison on periodLabel works: it's always
 * YYYY-MM-DD.
 */
export async function getDailyDigestIdsForCurrentWeek(): Promise<number[]> {
  const monday = currentWeekMondayLabel();
  const today = dailyPeriodLabel();
  const rows = await db
    .select({ id: digests.id })
    .from(digests)
    .where(and(eq(digests.frequency, "daily"), gte(digests.periodLabel, monday), lte(digests.periodLabel, today)));
  return rows.map((r) => r.id);
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

/** News for one interest: curated fetch if it has a source, else a generated
 * Field News Roundup. Daily cadence — attaches to the daily cycle, unless
 * ROUNDUP_ITEMS_CADENCE is flipped to "weekly" for a roundup-sourced
 * interest (no registered fetcher). */
export async function refreshNewsForInterest(interestId: number): Promise<NewsStepResult | null> {
  const interest = await getInterestById(interestId);
  if (!interest || !interest.enabled) return null;

  // Phase 14 (engagement-based pruning): auto-generation for this
  // (interest, "news") combination may have been switched off after a
  // sustained stretch of low engagement — see engagement.ts. The dedicated
  // "Generate now" action (generateNowForContentType) bypasses this check;
  // this is only the automatic/scheduled path (RefreshButton, npm run
  // fetch, and the scheduled batch pipeline all route through here).
  if (!(await isAutoGenerationEnabled(interestId, "news"))) {
    return { interestId, interestName: interest.name, added: 0, fetched: 0 };
  }

  const usesWeeklyCycle = !interest.hasCuratedSource && ROUNDUP_ITEMS_CADENCE === "weekly";
  const cycleId = usesWeeklyCycle ? await getOrCreateWeeklyCycleId() : await getOrCreateDailyCycleId();
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
  // Phase 15 (Syllabus Awareness) — empty array for an interest with no
  // attached syllabus, which generateDeepDive/computeSyllabusComparison
  // both treat as "nothing to compare against" (never a false gap claim).
  const syllabusContext = await getSyllabusContext(interest.id);
  const result = await generateDeepDive(interest.name, level, covered, opts.forcedTopic, syllabusContext);
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
      syllabusComparison: result.syllabusComparison ? JSON.stringify(result.syllabusComparison) : null,
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
 * One Deep Dive for one interest, for the current WEEKLY cycle (Phase 13) —
 * no-op once this week has reached its quota (WEEKLY_DEEP_DIVE_QUOTA_NORMAL,
 * or _FAVORITE for a favorited/Passion Mode interest). Called once per HTTP
 * request; the caller loops (see RefreshButton.tsx / runInterestCycle below)
 * to fill a >1 quota across multiple short requests rather than one long one.
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

  // Phase 14 (engagement-based pruning) — see refreshNewsForInterest's
  // comment above for the full reasoning; same contract here.
  if (!(await isAutoGenerationEnabled(interestId, "deep_dive"))) {
    return { interestId, interestName: interest.name, added: false, topic: null };
  }

  const cycleId = await getOrCreateWeeklyCycleId();
  const quota = interest.isFavorite ? WEEKLY_DEEP_DIVE_QUOTA_FAVORITE : WEEKLY_DEEP_DIVE_QUOTA_NORMAL;
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

  const cycleId = await getOrCreateWeeklyCycleId();
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
  // Phase 14 (engagement-based pruning) — see refreshNewsForInterest's
  // comment above for the full reasoning; same contract here.
  if (!(await isAutoGenerationEnabled(interestId, "applied_insight"))) {
    return { interestId, interestName: interest.name, added: false };
  }

  const cycleId = await getOrCreateWeeklyCycleId();
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

  const cycleId = await getOrCreateWeeklyCycleId();
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
export function daysAgoSqlite(days: number): string {
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
    // Phase 14 (engagement-based pruning) — this cycle-level step scans
    // across every interest's recent dives, so the check has to happen
    // per-candidate here rather than once up front. See
    // refreshNewsForInterest's comment for the full reasoning.
    if (!(await isAutoGenerationEnabled(candidate.interestId, "drill"))) continue;

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
  // Phase 14 (engagement-based pruning) — see refreshNewsForInterest's
  // comment above for the full reasoning.
  if (!(await isAutoGenerationEnabled(targetInterest.id, "drill"))) return false;

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
 * Cycle-level Mental Model of the Week step (Phase 13: 2-3/week instead of
 * 1/day) — picks mental models not used recently, gathers this WEEK's
 * fetched items (across every daily cycle so far this week) and this week's
 * surfaced Library chapters, and asks Claude to connect each model to one or
 * two of them concretely. Idempotent: tops up to MENTAL_MODEL_WEEKLY_TARGET
 * rather than duplicating past that. Declines (no row added, for that
 * attempt) if nothing fits any recently-unused model naturally. Returns how
 * many were added.
 */
export async function refreshMentalModelsForCycle(): Promise<number> {
  if (!hasClaudeKey()) return 0;

  const cycleId = await getOrCreateWeeklyCycleId();
  const existingUsage = await db
    .select({ id: modelUsage.id, modelId: modelUsage.modelId })
    .from(modelUsage)
    .where(eq(modelUsage.digestId, cycleId));
  const remaining = MENTAL_MODEL_WEEKLY_TARGET - existingUsage.length;
  if (remaining <= 0) return 0;
  const usedThisCycleModelIds = new Set(existingUsage.map((r) => r.modelId));

  // Not gated on enabledInterests.length: a Library book's chapters (below)
  // are eligible candidates independent of whether any interest is enabled.
  const enabledInterests = await getEnabledInterests();
  const interestNameById = new Map(enabledInterests.map((i) => [i.id, i.name]));

  const dailyIdsThisWeek = await getDailyDigestIdsForCurrentWeek();
  const itemRows =
    dailyIdsThisWeek.length > 0
      ? await db
          .select({ id: items.id, title: items.title, summary: items.summary, interestId: items.interestId })
          .from(items)
          .where(inArray(items.digestId, dailyIdsThisWeek))
          .orderBy(desc(items.score))
          .limit(MENTAL_MODEL_ITEM_CANDIDATES)
      : [];
  const itemCandidates = itemRows
    .filter((r) => r.interestId != null && interestNameById.has(r.interestId))
    .map((r) => ({
      title: r.title,
      summary: r.summary,
      interestName: interestNameById.get(r.interestId!)!,
      ref: { type: "item" as const, id: r.id },
    }));

  // Library chapters surfaced THIS (weekly) cycle are eligible too, same as
  // any interest content — see refreshBookChapterForCycle, which runs
  // before this step (both are called from the same cycle-steps sequence).
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
  if (candidates.length === 0) return 0;

  let added = 0;
  for (let round = 0; round < remaining; round++) {
    // Recently-used models (by most recent dateUsed) plus anything already
    // used THIS cycle, excluded from selection so the feature doesn't repeat
    // the same lens over and over within or across weeks.
    const recentUsageRows = await db
      .select({ modelId: modelUsage.modelId })
      .from(modelUsage)
      .orderBy(desc(modelUsage.dateUsed))
      .limit(MODEL_USAGE_LOOKBACK);
    const excludedIds = [...new Set([...recentUsageRows.map((r) => r.modelId), ...usedThisCycleModelIds])];

    const availableModels =
      excludedIds.length > 0
        ? await db.select().from(mentalModels).where(notInArray(mentalModels.id, excludedIds))
        : await db.select().from(mentalModels);
    const pool = availableModels.length > 0 ? availableModels : await db.select().from(mentalModels);
    if (pool.length === 0) break;

    // Try a few random models (not just one) in case the first pick doesn't
    // cleanly apply to this week's actual items — generateMentalModelLens
    // declines rather than forcing a strained connection.
    const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);

    let addedThisRound = false;
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
          interestLabel: "Mental Model of the Week",
          interestId: null,
          date: new Date().toISOString(),
          url: `/archive/${cycleId}?at=mentalmodel-${insertedUsage[0].id}`,
        }).catch((err) => console.error("[pipeline] search-index failed for mental model usage:", err));
        usedThisCycleModelIds.add(model.id);
        added++;
        addedThisRound = true;
        break;
      } catch (err) {
        console.error(`[pipeline] Mental model lens failed for "${model.name}":`, err);
      }
    }
    if (!addedThisRound) break; // no candidate model worked this round — stop rather than spin
  }
  return added;
}

/**
 * Cycle-level Rabbit Hole of the Week step (Phase 13: 1-2/week instead of
 * 1/day) — item(s) entirely outside the reader's active interests, via web
 * search. Idempotent: tops up to RABBIT_HOLE_WEEKLY_TARGET rather than
 * duplicating past it. Returns how many were added.
 */
export async function refreshRabbitHolesForCycle(): Promise<number> {
  if (!hasClaudeKey()) return 0;

  const cycleId = await getOrCreateWeeklyCycleId();
  const existing = await db.select({ id: rabbitHoles.id }).from(rabbitHoles).where(eq(rabbitHoles.digestId, cycleId));
  const remaining = RABBIT_HOLE_WEEKLY_TARGET - existing.length;
  if (remaining <= 0) return 0;

  const enabledInterests = await getEnabledInterests();
  const activeNames = enabledInterests.map((i) => i.name);

  let added = 0;
  for (let round = 0; round < remaining; round++) {
    const recentRows = await db
      .select({ topicArea: rabbitHoles.topicArea })
      .from(rabbitHoles)
      .orderBy(desc(rabbitHoles.createdAt))
      .limit(RABBIT_HOLE_AVOID_LOOKBACK);
    const avoidTopics = recentRows.map((r) => r.topicArea);

    try {
      const result = await generateRabbitHole(activeNames, avoidTopics);
      if (!result) break; // declined — nothing left that avoids recent topics naturally

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
      added++;
    } catch (err) {
      console.error("[pipeline] Rabbit hole generation failed:", err);
      break;
    }
  }
  return added;
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
  const cycleId = await getOrCreateWeeklyCycleId();
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
 * Steelman companion (Phase 13: moved weekly — was a daily, per-refresh
 * step): for interests where argument is central (a fixed slug list, plus
 * any custom interest), generates up to STEELMAN_TARGET_PER_INTEREST
 * counterarguments per WEEK for this interest's freshly-fetched items
 * (scanned across every daily cycle so far this week, not just today's)
 * that present a genuine arguable thesis. One combined Claude call (with
 * web_search) covers up to STEELMAN_CANDIDATE_POOL candidates, rather than
 * one call per item, to bound cost. Idempotent: only tops up to the
 * per-week target, so a retry never re-generates items that already have
 * one. Called once per enabled interest as its own weekly step (see
 * runDigestPipeline / /api/refresh/steelman), decoupled from the daily News
 * step so it doesn't run on every refresh.
 */
export async function refreshSteelmansForInterest(interestId: number, opts: { bypassPrune?: boolean } = {}): Promise<number> {
  if (!hasClaudeKey()) return 0;
  const interest = await getInterestById(interestId);
  if (!interest || !interest.enabled) return 0;
  const eligible = STEELMAN_ELIGIBLE_SLUGS.has(interest.slug) || interest.isCustom;
  if (!eligible) return 0;
  // Phase 14 (engagement-based pruning) — see refreshNewsForInterest's
  // comment above for the full reasoning. `bypassPrune` is set only by the
  // dedicated "Generate now" action (generateNowForContentType).
  if (!opts.bypassPrune && !(await isAutoGenerationEnabled(interestId, "steelman"))) return 0;

  const dailyIdsThisWeek = await getDailyDigestIdsForCurrentWeek();
  if (dailyIdsThisWeek.length === 0) return 0;

  const existingCount = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(eq(items.interestId, interest.id), inArray(items.digestId, dailyIdsThisWeek), isNotNull(items.steelmanContent))
    );
  const needed = STEELMAN_TARGET_PER_INTEREST - existingCount.length;
  if (needed <= 0) return 0;

  const candidateRows = await db
    .select({ id: items.id, title: items.title, summary: items.summary })
    .from(items)
    .where(
      and(eq(items.interestId, interest.id), inArray(items.digestId, dailyIdsThisWeek), isNull(items.steelmanContent))
    )
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
  const dailyCycleId = await getOrCreateDailyCycleId();
  const weeklyCycleId = await getOrCreateWeeklyCycleId();
  const enabledInterests = await getEnabledInterests();

  if (enabledInterests.length === 0) {
    // Library books are read independently of the interests system — still
    // drip-feed a chapter even if the reader has no interests enabled.
    const bookChapterResult = await refreshBookChapterForCycle().catch((err) => {
      console.error("[pipeline] Book chapter drip-feed step failed:", err);
      return { chaptersSurfaced: 0 };
    });
    return {
      dailyCycleId,
      weeklyCycleId,
      newsAdded: 0,
      deepDivesAdded: 0,
      appliedInsightsAdded: 0,
      drillsAdded: 0,
      steelmansAdded: 0,
      mentalModelsAdded: 0,
      rabbitHolesAdded: 0,
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
  const mentalModelsAdded = await refreshMentalModelsForCycle().catch((err) => {
    console.error("[pipeline] Mental model step failed:", err);
    return 0;
  });
  const rabbitHolesAdded = await refreshRabbitHolesForCycle().catch((err) => {
    console.error("[pipeline] Rabbit hole step failed:", err);
    return 0;
  });

  const newBrainFacts = await maybeGenerateWeeklyFacts().catch((err) => {
    console.error("[pipeline] weekly brain fact generation failed:", err);
    return 0;
  });

  return {
    dailyCycleId,
    weeklyCycleId,
    newsAdded: results.reduce((sum, r) => sum + r.newsAdded, 0),
    deepDivesAdded: results.filter((r) => r.deepDiveAdded).length,
    appliedInsightsAdded: results.filter((r) => r.insightAdded).length,
    drillsAdded: drillsResult.groundedAdded + (drillsResult.standaloneAdded ? 1 : 0),
    steelmansAdded: results.reduce((sum, r) => sum + r.steelmansAdded, 0),
    mentalModelsAdded,
    rabbitHolesAdded,
    chaptersSurfaced: bookChapterResult.chaptersSurfaced,
    fetchedCount: results.reduce((sum, r) => sum + r.fetched, 0),
    usedClaude: hasClaudeKey(),
    newBrainFacts,
    enabledInterestCount: enabledInterests.length,
  };
}

/** News + Deep Dive(s) + Applied Insight(s) + Steelman(s) for one interest,
 * built from the granular step functions above. Loops the deep-dive step to
 * fill a favorited interest's full per-week quota (>1) — safe because
 * refreshDeepDiveForInterest no-ops once quota is reached, so the loop just
 * stops early for a non-favorited (quota 1) interest. */
async function runInterestCycle(interest: InterestWithConfig): Promise<InterestCycleResult> {
  const news = await refreshNewsForInterest(interest.id);

  let deepDiveAdded = false;
  for (let i = 0; i < WEEKLY_DEEP_DIVE_QUOTA_FAVORITE; i++) {
    const dive = await refreshDeepDiveForInterest(interest.id);
    if (dive?.added) deepDiveAdded = true;
    else break;
  }

  const insight = await refreshInsightForInterest(interest.id);
  const steelmansAdded = await refreshSteelmansForInterest(interest.id).catch((err) => {
    console.error(`[pipeline] Steelman step failed for "${interest.name}":`, err);
    return 0;
  });
  return {
    newsAdded: news?.added ?? 0,
    fetched: news?.fetched ?? 0,
    deepDiveAdded,
    insightAdded: insight?.added ?? false,
    steelmansAdded,
  };
}

/** Dedupes a batch against everything already persisted, returning only genuinely new items. */
export async function filterFresh(rawItems: RawItem[]): Promise<RawItem[]> {
  const deduped = dedupeItems(rawItems);
  const existingKeysResult = await client.execute("SELECT dedupe_key FROM items");
  const existingKeys = new Set(existingKeysResult.rows.map((r: any) => r.dedupe_key as string));
  return deduped.filter((item) => !existingKeys.has(dedupeKeyFor(item)));
}

/** Inserts processed items one at a time, skipping (not aborting the batch on) a rare dedupe-key race. */
export async function insertItems(
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
          citationMetadata: JSON.stringify(item.citationMetadata ?? {}),
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
export const ROUNDUP_FOCUS_OVERRIDES: Record<string, string> = {
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
 * the same ~250-320 word abstract-style target as every other News source,
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

// ---------------------------------------------------------------------------
// Phase 14 (Cost Optimization) — "Generate now": the explicit, on-demand
// counterpart to a (interest, contentType) combination the pruning sweep
// switched to on_demand (see engagement.ts). Lives in the interest's own
// area of the UI, always available regardless of engagement history —
// bypasses isAutoGenerationEnabled entirely (that's the point: the reader
// asked for one, right now), but otherwise reuses the exact same
// generation/persistence logic as the scheduled steps above, so the content
// it produces is indistinguishable from anything auto-generated.
// ---------------------------------------------------------------------------

export interface GenerateNowResult {
  added: boolean;
  message?: string; // set when nothing was added, to explain why (e.g. "declined — nothing to interrogate")
}

export async function generateNowForContentType(
  interestId: number,
  contentType: PrunableContentType
): Promise<GenerateNowResult> {
  const interest = await getInterestById(interestId);
  if (!interest || !interest.enabled) return { added: false, message: "Interest not found or not enabled." };
  if (!hasClaudeKey()) return { added: false, message: "No Anthropic API key configured." };

  switch (contentType) {
    case "news": {
      const cycleId = await getOrCreateDailyCycleId();
      const result = await (interest.hasCuratedSource ? runCuratedNews(interest, cycleId) : runRoundupNews(interest, cycleId)).catch(
        (err) => {
          console.error(`[pipeline] Generate-now News failed for "${interest.name}":`, err);
          return { added: 0, fetched: 0 };
        }
      );
      return result.added > 0 ? { added: true } : { added: false, message: "Nothing new found right now." };
    }

    case "deep_dive": {
      const cycleId = await getOrCreateWeeklyCycleId();
      const result = await generateAndPersistDeepDive(interest, cycleId).catch((err) => {
        console.error(`[pipeline] Generate-now Deep Dive failed for "${interest.name}":`, err);
        return null;
      });
      if (result && interest.generatesAppliedInsights) {
        await generateInsightForDive(interest, result.id).catch((err) => {
          console.error(`[pipeline] Generate-now Applied Insight (from Deep Dive) failed for "${interest.name}":`, err);
        });
      }
      return result ? { added: true } : { added: false, message: "Generation failed — see server logs." };
    }

    case "applied_insight": {
      const diveRows = await db
        .select()
        .from(deepDives)
        .where(eq(deepDives.interestId, interestId))
        .orderBy(desc(deepDives.createdAt))
        .limit(1);
      const dive = diveRows[0];
      if (!dive) return { added: false, message: "No Deep Dive yet to base an Applied Insight on." };

      // "Generate now" is an explicit new request, not an idempotency check
      // — unlike generateInsightForDive, this doesn't skip an already-
      // insighted dive; it tries again regardless.
      const content = await generateAppliedInsight(interest.name, dive.topic, dive.content);
      if (!content) return { added: false, message: "This topic doesn't have a natural everyday application." };

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
      }).catch((err) => console.error("[pipeline] search-index failed for generate-now applied insight:", err));
      return { added: true };
    }

    case "drill": {
      const cycleId = await getOrCreateWeeklyCycleId();
      const diveRows = await db
        .select()
        .from(deepDives)
        .where(eq(deepDives.interestId, interestId))
        .orderBy(desc(deepDives.createdAt))
        .limit(1);

      if (diveRows[0]) {
        const dive = diveRows[0];
        const result = await generateGroundedDrill(interest.name, dive.topic, dive.content).catch((err) => {
          console.error(`[pipeline] Generate-now grounded drill failed for "${interest.name}":`, err);
          return null;
        });
        if (result) {
          const inserted = await db
            .insert(drills)
            .values({
              interestId: interest.id,
              sourceDeepDiveId: dive.id,
              drillType: result.drillType,
              promptContent: result.promptContent,
              options: JSON.stringify(result.options),
              correctOption: result.correctOption,
              explanation: result.explanation,
              conceptLabel: result.conceptLabel,
              digestId: cycleId,
            })
            .returning({ id: drills.id });
          await addCoveredTopic(interest.id, result.conceptLabel, dive.id);
          indexForSearch({
            contentType: "drill",
            sourceId: inserted[0].id,
            title: `Drill — ${result.conceptLabel}`,
            body: `${result.promptContent}\n\n${result.explanation}`,
            interestLabel: interest.name,
            interestId: interest.id,
            date: new Date().toISOString(),
            url: "/drills",
          }).catch((err) => console.error("[pipeline] search-index failed for generate-now drill:", err));
          if (interest.generatesAppliedInsights) {
            await generateInsightForDrill(interest, inserted[0].id).catch((err) => {
              console.error(`[pipeline] Generate-now Applied Insight (from drill) failed for "${interest.name}":`, err);
            });
          }
          return { added: true };
        }
      }

      // No grounded drill came out of the most recent dive (or there isn't
      // one) — fall back to a standalone formal-logic drill, but only for
      // an interest that's actually Critical Thinking/Logic itself, same as
      // the automatic addStandaloneLogicDrill's eligibility.
      if (interest.slug === "critical-thinking" || interest.slug === "logic") {
        const covered = await getCoveredTopics(interest.id);
        const result = await generateStandaloneLogicDrill(covered.recent).catch((err) => {
          console.error(`[pipeline] Generate-now standalone drill failed for "${interest.name}":`, err);
          return null;
        });
        if (result) {
          const inserted = await db
            .insert(drills)
            .values({
              interestId: interest.id,
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
          await addCoveredTopic(interest.id, result.conceptLabel, null);
          indexForSearch({
            contentType: "drill",
            sourceId: inserted[0].id,
            title: `Drill — ${result.conceptLabel}`,
            body: `${result.promptContent}\n\n${result.explanation}`,
            interestLabel: interest.name,
            interestId: interest.id,
            date: new Date().toISOString(),
            url: "/drills",
          }).catch((err) => console.error("[pipeline] search-index failed for generate-now standalone drill:", err));
          return { added: true };
        }
      }

      return { added: false, message: "Nothing drillable found right now." };
    }

    case "steelman": {
      const added = await refreshSteelmansForInterest(interestId, { bypassPrune: true });
      return added > 0 ? { added: true } : { added: false, message: "No qualifying arguable items right now." };
    }
  }
}

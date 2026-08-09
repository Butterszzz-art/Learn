import { db, client } from "@/db";
import { digests, items, settings, deepDives, appliedInsights, drills } from "@/db/schema";
import type { Category } from "@/db/schema";
import { bumpLevel } from "@/db/schema";
import { eq, and, gte, desc, isNotNull } from "drizzle-orm";
import { fetchForInterest } from "./fetchers/registry";
import { generateFieldNewsRoundup } from "./newsRoundup";
import { dedupeItems, dedupeKeyFor } from "./dedupe";
import { categorizeByKeywords } from "./categorize";
import { classifyAndSummarizeBatch, summarizeBatch, hasClaudeKey } from "./claude";
import {
  generateDeepDive,
  generateAppliedInsight,
  generateFollowUpTopics,
  generateSelfCheckQuestions,
} from "./deepDive";
import { generateGroundedDrill, generateStandaloneLogicDrill } from "./drills";
import { scoreItem } from "./score";
import { pickBrainFactOfTheDay, maybeGenerateWeeklyFacts } from "./brainFact";
import {
  getEnabledInterests,
  getInterestById,
  getInterestBySlug,
  getCoveredTopics,
  addCoveredTopic,
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

export interface PipelineResult {
  cycleId: number;
  newsAdded: number;
  deepDivesAdded: number;
  appliedInsightsAdded: number;
  drillsAdded: number;
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

  const [followUps, selfCheck] = await Promise.all([
    generateFollowUpTopics(interest.name, result.topic, result.content).catch((err) => {
      console.error(`[pipeline] Follow-up generation failed for "${interest.name}":`, err);
      return [];
    }),
    generateSelfCheckQuestions(interest.name, result.topic, result.content).catch((err) => {
      console.error(`[pipeline] Self-check generation failed for "${interest.name}":`, err);
      return [];
    }),
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
    })
    .returning({ id: deepDives.id });

  const deepDiveId = inserted[0].id;
  await addCoveredTopic(interest.id, result.topic, deepDiveId);
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

  await db.insert(appliedInsights).values({ interestId: interest.id, deepDiveId: dive.id, content });
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

  await db.insert(appliedInsights).values({ interestId: interest.id, drillId: drill.id, content });
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
    return {
      cycleId,
      newsAdded: 0,
      deepDivesAdded: 0,
      appliedInsightsAdded: 0,
      drillsAdded: 0,
      fetchedCount: 0,
      usedClaude: hasClaudeKey(),
      newBrainFacts: 0,
      enabledInterestCount: 0,
    };
  }

  const results = await Promise.all(enabledInterests.map((interest) => runInterestCycle(interest)));

  // Drills scan across ALL interests' deep dives, so this runs once, after
  // every interest's News/Deep Dive/Applied Insight steps above have settled.
  const drillsResult = await refreshDrillsForCycle().catch((err) => {
    console.error("[pipeline] Drills step failed:", err);
    return { groundedAdded: 0, standaloneAdded: false };
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
  cycleId: number
): Promise<number> {
  let inserted = 0;
  for (const item of processed) {
    try {
      await db.insert(items).values({
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
      });
      inserted++;
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
  const neuroResults = isNeuro ? await classifyAndSummarizeBatch(items_) : null;
  const otherResults = isNeuro ? null : await summarizeBatch(items_);

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

  const added = await insertItems(processed, interest.id, cycleId);
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
 * Roundup. Items arrive already summarized in the app's own words, so —
 * unlike curated items — they skip the summarize step entirely.
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

  const processed: ProcessedItem[] = fresh.map((item) => ({
    ...item,
    category: null,
    summary: item.snippet, // already Claude-authored, in the app's own words — see newsRoundup.ts
    score: scoreItem(item),
    dedupeKey: dedupeKeyFor(item),
  }));

  processed.sort((a, b) => b.score - a.score);
  const selected = processed.slice(0, TARGET_ROUNDUP_ITEMS);
  const added = await insertItems(selected, interest.id, cycleId);
  return { added, fetched: fetchedCount };
}

import { db, client } from "@/db";
import { digests, items, settings, deepDives, appliedInsights } from "@/db/schema";
import type { Category } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { fetchForInterest } from "./fetchers/registry";
import { generateFieldNewsRoundup } from "./newsRoundup";
import { dedupeItems, dedupeKeyFor } from "./dedupe";
import { categorizeByKeywords } from "./categorize";
import { classifyAndSummarizeBatch, summarizeBatch, hasClaudeKey } from "./claude";
import { generateDeepDive, generateAppliedInsight } from "./deepDive";
import { scoreItem } from "./score";
import { pickBrainFactOfTheDay, maybeGenerateWeeklyFacts } from "./brainFact";
import { getEnabledInterests, getInterestById, getCoveredTopics, addCoveredTopic } from "./interests";
import type { InterestWithConfig } from "./interests";
import type { RawItem, ProcessedItem } from "./types";

const TARGET_ITEMS_PER_INTEREST = 8; // curated (RSS/API) sources
const TARGET_ROUNDUP_ITEMS = 5; // generated Field News Roundup

export interface PipelineResult {
  cycleId: number;
  newsAdded: number;
  deepDivesAdded: number;
  appliedInsightsAdded: number;
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

/** One Deep Dive for one interest, for the current cycle — no-op if this cycle already has one. */
export async function refreshDeepDiveForInterest(interestId: number): Promise<DeepDiveStepResult | null> {
  const interest = await getInterestById(interestId);
  if (!interest || !interest.enabled) return null;
  if (!hasClaudeKey()) return { interestId, interestName: interest.name, added: false, topic: null };

  const cycleId = await getOrCreateCurrentCycleId();

  const existing = await db
    .select()
    .from(deepDives)
    .where(and(eq(deepDives.interestId, interest.id), eq(deepDives.digestId, cycleId)))
    .limit(1);
  if (existing.length > 0) {
    return { interestId, interestName: interest.name, added: false, topic: existing[0].topic };
  }

  try {
    const covered = await getCoveredTopics(interest.id);
    const result = await generateDeepDive(interest.name, interest.level, covered);
    if (!result) {
      console.error(`[pipeline] generateDeepDive returned null for "${interest.name}" — see [deepDive] log above.`);
      return { interestId, interestName: interest.name, added: false, topic: null };
    }
    await db.insert(deepDives).values({
      interestId: interest.id,
      topic: result.topic,
      content: result.content,
      sources: JSON.stringify(result.sources),
      level: interest.level,
      digestId: cycleId,
    });
    await addCoveredTopic(interest.id, result.topic);
    return { interestId, interestName: interest.name, added: true, topic: result.topic };
  } catch (err) {
    console.error(`[pipeline] Deep dive failed for "${interest.name}":`, err);
    return { interestId, interestName: interest.name, added: false, topic: null };
  }
}

export interface InsightStepResult {
  interestId: number;
  interestName: string;
  added: boolean;
}

/** One Applied Insight for one interest, off this cycle's deep dive — no-op if not applicable/already exists/no dive yet. */
export async function refreshInsightForInterest(interestId: number): Promise<InsightStepResult | null> {
  const interest = await getInterestById(interestId);
  if (!interest || !interest.enabled) return null;
  if (!interest.generatesAppliedInsights || !hasClaudeKey()) {
    return { interestId, interestName: interest.name, added: false };
  }

  const cycleId = await getOrCreateCurrentCycleId();
  const diveRows = await db
    .select()
    .from(deepDives)
    .where(and(eq(deepDives.interestId, interest.id), eq(deepDives.digestId, cycleId)))
    .limit(1);
  const deepDiveRow = diveRows[0];
  if (!deepDiveRow) return { interestId, interestName: interest.name, added: false }; // nothing to base an insight on yet

  try {
    const existingInsight = await db
      .select({ id: appliedInsights.id })
      .from(appliedInsights)
      .where(eq(appliedInsights.deepDiveId, deepDiveRow.id))
      .limit(1);
    if (existingInsight.length > 0) return { interestId, interestName: interest.name, added: false };

    const content = await generateAppliedInsight(interest.name, deepDiveRow.topic, deepDiveRow.content);
    if (!content) return { interestId, interestName: interest.name, added: false };

    await db.insert(appliedInsights).values({ interestId: interest.id, deepDiveId: deepDiveRow.id, content });
    return { interestId, interestName: interest.name, added: true };
  } catch (err) {
    console.error(`[pipeline] Applied insight failed for "${interest.name}":`, err);
    return { interestId, interestName: interest.name, added: false };
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
      fetchedCount: 0,
      usedClaude: hasClaudeKey(),
      newBrainFacts: 0,
      enabledInterestCount: 0,
    };
  }

  const results = await Promise.all(enabledInterests.map((interest) => runInterestCycle(interest)));

  const newBrainFacts = await maybeGenerateWeeklyFacts().catch((err) => {
    console.error("[pipeline] weekly brain fact generation failed:", err);
    return 0;
  });

  return {
    cycleId,
    newsAdded: results.reduce((sum, r) => sum + r.newsAdded, 0),
    deepDivesAdded: results.filter((r) => r.deepDiveAdded).length,
    appliedInsightsAdded: results.filter((r) => r.insightAdded).length,
    fetchedCount: results.reduce((sum, r) => sum + r.fetched, 0),
    usedClaude: hasClaudeKey(),
    newBrainFacts,
    enabledInterestCount: enabledInterests.length,
  };
}

/** News + Deep Dive + Applied Insight for one interest, built from the granular step functions above. */
async function runInterestCycle(interest: InterestWithConfig): Promise<InterestCycleResult> {
  const news = await refreshNewsForInterest(interest.id);
  const dive = await refreshDeepDiveForInterest(interest.id);
  const insight = await refreshInsightForInterest(interest.id);
  return {
    newsAdded: news?.added ?? 0,
    fetched: news?.fetched ?? 0,
    deepDiveAdded: dive?.added ?? false,
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

/**
 * News for an interest with no registered fetcher (any custom interest, or
 * Business/Political Science): a Claude-generated, web-search-grounded
 * Field News Roundup. Items arrive already summarized in the app's own
 * words, so — unlike curated items — they skip the summarize step entirely.
 */
async function runRoundupNews(
  interest: InterestWithConfig,
  cycleId: number
): Promise<{ added: number; fetched: number }> {
  if (!hasClaudeKey()) return { added: 0, fetched: 0 };

  const rawItems = await generateFieldNewsRoundup(interest.name);
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

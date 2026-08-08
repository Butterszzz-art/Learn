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
import { getEnabledInterests, getCoveredTopics, addCoveredTopic } from "./interests";
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
 * Runs the full pipeline for one refresh: for every enabled interest, in
 * parallel — fetches/generates that interest's News, generates one Deep
 * Dive if this cycle doesn't already have one, and (if applicable) one
 * Applied Insight off that deep dive. Every interest is fully isolated: one
 * failing never blocks the others, and a failure partway through an
 * interest (e.g. News succeeds, Deep Dive throws) still returns partial
 * results rather than losing what already succeeded.
 */
export async function runDigestPipeline(): Promise<PipelineResult> {
  const frequency = await getFrequency();
  const enabledInterests = await getEnabledInterests();
  const cycleId = await ensureCycleHasBrainFact(await findOrCreateCurrentCycle(frequency));

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

  const results = await Promise.all(
    enabledInterests.map((interest) => runInterestCycle(interest, cycleId))
  );

  const newBrainFacts = await maybeGenerateWeeklyFacts().catch((err) => {
    console.error("[pipeline] weekly brain fact generation failed:", err);
    return 0;
  });

  if (results.some((r) => r.newsAdded > 0)) {
    await db.update(settings).set({ lastRefreshAt: new Date().toISOString() }).where(eq(settings.id, 1));
  }

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

/** News + Deep Dive + Applied Insight for one interest. Never throws — every step is self-isolating. */
async function runInterestCycle(
  interest: InterestWithConfig,
  cycleId: number
): Promise<InterestCycleResult> {
  const newsResult = await (interest.hasCuratedSource
    ? runCuratedNews(interest, cycleId)
    : runRoundupNews(interest, cycleId)
  ).catch((err) => {
    console.error(`[pipeline] News failed for "${interest.name}":`, err);
    return { added: 0, fetched: 0 };
  });

  let deepDiveAdded = false;
  let deepDiveRow: { id: number; topic: string; content: string } | null = null;

  if (hasClaudeKey()) {
    try {
      const existingDive = await db
        .select()
        .from(deepDives)
        .where(and(eq(deepDives.interestId, interest.id), eq(deepDives.digestId, cycleId)))
        .limit(1);

      if (existingDive.length > 0) {
        deepDiveRow = existingDive[0];
      } else {
        const covered = await getCoveredTopics(interest.id);
        const result = await generateDeepDive(interest.name, interest.level, covered);
        if (result) {
          const inserted = await db
            .insert(deepDives)
            .values({
              interestId: interest.id,
              topic: result.topic,
              content: result.content,
              sources: JSON.stringify(result.sources),
              level: interest.level,
              digestId: cycleId,
            })
            .returning();
          await addCoveredTopic(interest.id, result.topic);
          deepDiveRow = inserted[0];
          deepDiveAdded = true;
        }
      }
    } catch (err) {
      console.error(`[pipeline] Deep dive failed for "${interest.name}":`, err);
    }
  }

  let insightAdded = false;
  if (interest.generatesAppliedInsights && deepDiveRow && hasClaudeKey()) {
    try {
      const existingInsight = await db
        .select({ id: appliedInsights.id })
        .from(appliedInsights)
        .where(eq(appliedInsights.deepDiveId, deepDiveRow.id))
        .limit(1);

      if (existingInsight.length === 0) {
        const content = await generateAppliedInsight(interest.name, deepDiveRow.topic, deepDiveRow.content);
        if (content) {
          await db
            .insert(appliedInsights)
            .values({ interestId: interest.id, deepDiveId: deepDiveRow.id, content });
          insightAdded = true;
        }
      }
    } catch (err) {
      console.error(`[pipeline] Applied insight failed for "${interest.name}":`, err);
    }
  }

  return { newsAdded: newsResult.added, fetched: newsResult.fetched, deepDiveAdded, insightAdded };
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

/** News for a hasCuratedSource=true interest: fetch its registered RSS/API source(s). */
async function runCuratedNews(
  interest: InterestWithConfig,
  cycleId: number
): Promise<{ added: number; fetched: number }> {
  const rawItems = await fetchForInterest(interest.slug);
  const fetchedCount = rawItems.length;
  if (fetchedCount === 0) return { added: 0, fetched: 0 };

  const fresh = await filterFresh(rawItems);
  if (fresh.length === 0) return { added: 0, fetched: fetchedCount };

  // Neuroscience keeps the legacy 4-category classifier; every other
  // curated interest just gets a plain summary (no forced category).
  const isNeuro = interest.slug === "neuroscience";
  const neuroResults = isNeuro ? await classifyAndSummarizeBatch(fresh) : null;
  const otherResults = isNeuro ? null : await summarizeBatch(fresh);

  const processed: ProcessedItem[] = fresh.map((item, idx) => {
    let category: Category | null = null;
    let summary: string;
    if (neuroResults) {
      const r = neuroResults.get(idx);
      category = r?.category ?? categorizeByKeywords(item);
      summary = r?.summary ?? (truncateSnippet(item.snippet) || "No summary available.");
    } else {
      summary = otherResults?.get(idx) ?? (truncateSnippet(item.snippet) || "No summary available.");
    }
    return { ...item, category, summary, score: scoreItem(item), dedupeKey: dedupeKeyFor(item) };
  });

  processed.sort((a, b) => b.score - a.score);
  const selected = processed.slice(0, TARGET_ITEMS_PER_INTEREST);
  const added = await insertItems(selected, interest.id, cycleId);
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

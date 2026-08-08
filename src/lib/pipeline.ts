import { db, client } from "@/db";
import { digests, items, settings, deepDives } from "@/db/schema";
import type { Category, Level } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { fetchForInterest } from "./fetchers/registry";
import { dedupeItems, dedupeKeyFor } from "./dedupe";
import { categorizeByKeywords } from "./categorize";
import { classifyAndSummarizeBatch, summarizeBatch, hasClaudeKey } from "./claude";
import { generateDeepDive } from "./deepDive";
import { scoreItem } from "./score";
import { pickBrainFactOfTheDay, maybeGenerateWeeklyFacts } from "./brainFact";
import { getEnabledInterests, getCoveredTopics, addCoveredTopic } from "./interests";
import type { RawItem, ProcessedItem } from "./types";

const TARGET_ITEMS_PER_INTEREST = 8;

export interface PipelineResult {
  cycleId: number;
  curatedAdded: number;
  deepDivesAdded: number;
  fetchedCount: number;
  usedClaude: boolean;
  newBrainFacts: number;
  enabledInterestCount: number;
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

/** Fetches curated items for every enabled+curated interest, in parallel. */
async function fetchCurated(
  enabledInterests: { id: number; slug: string; hasCuratedSource: boolean }[]
): Promise<{ interestId: number; item: RawItem }[]> {
  const curated = enabledInterests.filter((i) => i.hasCuratedSource);
  const results = await Promise.all(
    curated.map(async (interest) => {
      const rawItems = await fetchForInterest(interest.slug);
      return rawItems.map((item) => ({ interestId: interest.id, item }));
    })
  );
  return results.flat();
}

/**
 * Runs the full pipeline for one refresh: fetches curated items for every
 * enabled interest, dedupes/categorizes/scores/persists the new ones into
 * the current cycle, and generates one deep dive per enabled interest that
 * doesn't already have one for this cycle. Both halves are best-effort per
 * interest — one failing never blocks the others.
 */
export async function runDigestPipeline(): Promise<PipelineResult> {
  const frequency = await getFrequency();
  const enabledInterests = await getEnabledInterests();
  const cycleId = await ensureCycleHasBrainFact(await findOrCreateCurrentCycle(frequency));

  if (enabledInterests.length === 0) {
    return {
      cycleId,
      curatedAdded: 0,
      deepDivesAdded: 0,
      fetchedCount: 0,
      usedClaude: hasClaudeKey(),
      newBrainFacts: 0,
      enabledInterestCount: 0,
    };
  }

  const [curatedAdded, deepDivesAdded] = await Promise.all([
    runCuratedFetch(enabledInterests, cycleId),
    runDeepDives(enabledInterests, cycleId),
  ]);

  const newBrainFacts = await maybeGenerateWeeklyFacts().catch((err) => {
    console.error("[pipeline] weekly brain fact generation failed:", err);
    return 0;
  });

  return {
    cycleId,
    curatedAdded: curatedAdded.added,
    deepDivesAdded,
    fetchedCount: curatedAdded.fetched,
    usedClaude: hasClaudeKey(),
    newBrainFacts,
    enabledInterestCount: enabledInterests.length,
  };
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

async function runCuratedFetch(
  enabledInterests: { id: number; slug: string; hasCuratedSource: boolean }[],
  cycleId: number
): Promise<{ added: number; fetched: number }> {
  const tagged = await fetchCurated(enabledInterests);
  const fetchedCount = tagged.length;
  if (fetchedCount === 0) return { added: 0, fetched: 0 };

  // Dedupe within this batch (URL + fuzzy title), preserving the interest tag.
  const dedupedRaw = dedupeItems(tagged.map((t) => t.item));
  const dedupedTagged = tagged.filter((t) => dedupedRaw.includes(t.item));

  // Drop anything whose dedupe key already exists in the DB.
  const existingKeysResult = await client.execute("SELECT dedupe_key FROM items");
  const existingKeys = new Set(existingKeysResult.rows.map((r: any) => r.dedupe_key as string));
  const fresh = dedupedTagged.filter((t) => !existingKeys.has(dedupeKeyFor(t.item)));
  if (fresh.length === 0) return { added: 0, fetched: fetchedCount };

  // Neuroscience uses the legacy 4-category classifier; everything else
  // just gets a plain summary (no forced category).
  const neuroInterestId = enabledInterests.find((i) => i.slug === "neuroscience")?.id;
  const neuroFresh = neuroInterestId ? fresh.filter((t) => t.interestId === neuroInterestId) : [];
  const otherFresh = fresh.filter((t) => t.interestId !== neuroInterestId);

  const [neuroResults, otherResults] = await Promise.all([
    classifyAndSummarizeBatch(neuroFresh.map((t) => t.item)),
    summarizeBatch(otherFresh.map((t) => t.item)),
  ]);

  const processedNeuro: (ProcessedItem & { interestId: number })[] = neuroFresh.map((t, idx) => {
    const claudeResult = neuroResults.get(idx);
    const category: Category = claudeResult?.category ?? categorizeByKeywords(t.item);
    const summary = claudeResult?.summary ?? (truncateSnippet(t.item.snippet) || "No summary available.");
    return {
      ...t.item,
      interestId: t.interestId,
      category,
      summary,
      score: scoreItem(t.item),
      dedupeKey: dedupeKeyFor(t.item),
    };
  });

  const processedOther: (ProcessedItem & { interestId: number })[] = otherFresh.map((t, idx) => {
    const summary = otherResults.get(idx) ?? (truncateSnippet(t.item.snippet) || "No summary available.");
    return {
      ...t.item,
      interestId: t.interestId,
      category: null, // legacy field, unused outside neuroscience
      summary,
      score: scoreItem(t.item),
      dedupeKey: dedupeKeyFor(t.item),
    };
  });

  const allProcessed = [...processedNeuro, ...processedOther];

  // Rank and cap PER interest, so no single interest crowds out the others.
  const byInterest = new Map<number, typeof allProcessed>();
  for (const item of allProcessed) {
    const list = byInterest.get(item.interestId) ?? [];
    list.push(item);
    byInterest.set(item.interestId, list);
  }

  const selected: typeof allProcessed = [];
  for (const list of byInterest.values()) {
    list.sort((a, b) => b.score - a.score);
    selected.push(...list.slice(0, TARGET_ITEMS_PER_INTEREST));
  }

  for (const item of selected) {
    await db.insert(items).values({
      title: item.title,
      authors: item.authors,
      summary: item.summary,
      rawSnippet: item.snippet,
      sourceName: item.sourceName,
      sourceType: item.sourceType,
      category: item.category,
      interestId: item.interestId,
      url: item.url,
      dedupeKey: item.dedupeKey,
      publishedAt: item.publishedAt,
      score: item.score,
      digestId: cycleId,
    });
  }

  await db.update(settings).set({ lastRefreshAt: new Date().toISOString() }).where(eq(settings.id, 1));

  return { added: selected.length, fetched: fetchedCount };
}

async function runDeepDives(
  enabledInterests: { id: number; name: string; level: Level }[],
  cycleId: number
): Promise<number> {
  if (!hasClaudeKey()) return 0;

  const results = await Promise.all(
    enabledInterests.map(async (interest) => {
      const existing = await db
        .select({ id: deepDives.id })
        .from(deepDives)
        .where(and(eq(deepDives.interestId, interest.id), eq(deepDives.digestId, cycleId)))
        .limit(1);
      if (existing.length > 0) return false; // already have one for this cycle

      const covered = await getCoveredTopics(interest.id);
      const result = await generateDeepDive(interest.name, interest.level, covered);
      if (!result) return false;

      await db.insert(deepDives).values({
        interestId: interest.id,
        topic: result.topic,
        content: result.content,
        sources: JSON.stringify(result.sources),
        level: interest.level,
        digestId: cycleId,
      });
      await addCoveredTopic(interest.id, result.topic);
      return true;
    })
  );

  return results.filter(Boolean).length;
}

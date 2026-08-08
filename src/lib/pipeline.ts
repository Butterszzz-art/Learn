import { db, client } from "@/db";
import { digests, items, settings } from "@/db/schema";
import type { Category } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { fetchPubMed } from "./fetchers/pubmed";
import { fetchArxiv } from "./fetchers/arxiv";
import { fetchBioRxiv } from "./fetchers/biorxiv";
import { fetchJournalism } from "./fetchers/journalism";
import { dedupeItems, dedupeKeyFor } from "./dedupe";
import { categorizeByKeywords } from "./categorize";
import { classifyAndSummarizeBatch, hasClaudeKey } from "./claude";
import { scoreItem } from "./score";
import { pickBrainFactOfTheDay, maybeGenerateWeeklyFacts } from "./brainFact";
import type { RawItem, ProcessedItem } from "./types";

const TARGET_DIGEST_SIZE = 18; // within the spec's ~15-20 range

export interface PipelineResult {
  digestId: number;
  itemCount: number;
  fetchedCount: number;
  newItemCount: number;
  noNewItems: boolean;
  usedClaude: boolean;
  newBrainFacts: number;
}

function truncateSnippet(snippet: string, max = 300): string {
  const s = (snippet || "").trim();
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

async function getSettings() {
  const rows = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  const row = rows[0];
  return {
    frequency: (row?.frequency as "daily" | "weekly") ?? "daily",
    mutedCategories: new Set<Category>(
      row?.mutedCategories ? (JSON.parse(row.mutedCategories) as Category[]) : []
    ),
  };
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

/** Fetches every source in parallel; each fetcher already isolates its own failures. */
async function fetchAll(): Promise<RawItem[]> {
  const [pubmed, arxiv, biorxiv, journalism] = await Promise.all([
    fetchPubMed(3, 25).catch((err) => {
      console.error("[pipeline] PubMed fetch failed:", err);
      return [];
    }),
    fetchArxiv(25).catch((err) => {
      console.error("[pipeline] arXiv fetch failed:", err);
      return [];
    }),
    fetchBioRxiv(25).catch((err) => {
      console.error("[pipeline] bioRxiv fetch failed:", err);
      return [];
    }),
    fetchJournalism(20).catch((err) => {
      console.error("[pipeline] Journalism fetch failed:", err);
      return [];
    }),
  ]);
  return [...pubmed, ...arxiv, ...biorxiv, ...journalism];
}

/**
 * Runs the full fetch -> dedupe -> categorize -> score -> compile pipeline
 * and persists a new digest. If nothing new was found (e.g. refreshing
 * twice in a row), no new digest is created and the most recent one is
 * returned instead, with `noNewItems: true`.
 */
export async function runDigestPipeline(): Promise<PipelineResult> {
  const { frequency, mutedCategories } = await getSettings();

  const rawFetched = await fetchAll();
  const deduped = dedupeItems(rawFetched);

  // Drop anything whose dedupe key already exists in the DB — it was
  // already surfaced in a past digest, and we don't want a unique-index
  // conflict on insert.
  const existingKeysResult = await client.execute("SELECT dedupe_key FROM items");
  const existingKeys = new Set(existingKeysResult.rows.map((r: any) => r.dedupe_key as string));
  const freshItems = deduped.filter((item) => !existingKeys.has(dedupeKeyFor(item)));

  if (freshItems.length === 0) {
    const latestRows = await db.select().from(digests).orderBy(desc(digests.id)).limit(1);
    const latest = latestRows[0];
    const newBrainFacts = await maybeGenerateWeeklyFacts().catch(() => 0);
    let itemCount = 0;
    if (latest) {
      const countResult = await client.execute({
        sql: "SELECT COUNT(*) as c FROM items WHERE digest_id = ?",
        args: [latest.id],
      });
      itemCount = Number((countResult.rows[0] as any)?.c ?? 0);
    }
    return {
      digestId: latest?.id ?? -1,
      itemCount,
      fetchedCount: rawFetched.length,
      newItemCount: 0,
      noNewItems: true,
      usedClaude: false,
      newBrainFacts,
    };
  }

  // Classify + summarize via Claude in batches; fall back to keyword rules
  // and a truncated snippet for anything Claude didn't (or couldn't) handle.
  const claudeResults = await classifyAndSummarizeBatch(freshItems);
  const usedClaude = hasClaudeKey();

  const processed: ProcessedItem[] = freshItems
    .map((item, idx) => {
      const claudeResult = claudeResults.get(idx);
      const category = claudeResult?.category ?? categorizeByKeywords(item);
      const summary =
        claudeResult?.summary ?? (truncateSnippet(item.snippet) || "No summary available.");
      return {
        ...item,
        category,
        summary,
        score: scoreItem(item),
        dedupeKey: dedupeKeyFor(item),
      };
    })
    .filter((item) => !mutedCategories.has(item.category));

  processed.sort((a, b) => b.score - a.score);
  const selected = processed.slice(0, TARGET_DIGEST_SIZE);

  const brainFact = await pickBrainFactOfTheDay();
  const newBrainFacts = await maybeGenerateWeeklyFacts().catch((err) => {
    console.error("[pipeline] weekly brain fact generation failed:", err);
    return 0;
  });

  const digestId = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(digests)
      .values({
        periodLabel: periodLabel(frequency),
        frequency,
        brainFactId: brainFact?.id ?? null,
      })
      .returning({ id: digests.id });
    const id = inserted[0].id;

    for (const item of selected) {
      await tx.insert(items).values({
        title: item.title,
        authors: item.authors,
        summary: item.summary,
        rawSnippet: item.snippet,
        sourceName: item.sourceName,
        sourceType: item.sourceType,
        category: item.category,
        url: item.url,
        dedupeKey: item.dedupeKey,
        publishedAt: item.publishedAt,
        score: item.score,
        digestId: id,
      });
    }

    await tx
      .update(settings)
      .set({ lastRefreshAt: new Date().toISOString() })
      .where(eq(settings.id, 1));

    return id;
  });

  return {
    digestId,
    itemCount: selected.length,
    fetchedCount: rawFetched.length,
    newItemCount: freshItems.length,
    noNewItems: false,
    usedClaude,
    newBrainFacts,
  };
}

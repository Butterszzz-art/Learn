// Upgrades items still holding the truncated fallback summary (the raw snippet
// cut at ~300 chars, ending in "…") to a full-length summary. The fallback is
// what an item gets when the summary provider was unavailable, rate-limited, or
// ran out of the request's time budget (see summaryDeadline). Used by
// /api/refresh/summaries (a few items per call, so each call fits a serverless
// time limit) and by scripts/resummarize.ts (the whole backlog in one go).
import { db } from "@/db";
import { items } from "@/db/schema";
import { eq, like, and, isNotNull, desc } from "drizzle-orm";
import { client } from "@/db";
import { buildSummaryTexts, firstSentence } from "./engine/news";
import { summarizeBatch, type SummaryRunStatus } from "./claude";
import { inventedNumbers } from "./summaryLlm";
import type { RawItem } from "./types";

export const MIN_SOURCE_CHARS = 600;

export type ItemRow = typeof items.$inferSelect;

/** Items still on the fallback summary, newest first. */
export function listFallbackItems(): Promise<ItemRow[]> {
  return db
    .select()
    .from(items)
    .where(and(like(items.summary, "%…"), isNotNull(items.rawSnippet)))
    .orderBy(desc(items.id));
}

export type UpgradeResult =
  | { status: "upgraded"; words: number; invented: string[] }
  | { status: "no-source" | "failed" | "out-of-time" };

/**
 * Re-summarizes one item. A stored abstract is used as-is; a short RSS-style
 * snippet gets its article page fetched, exactly like the live pipeline's
 * buildSummaryTexts. "out-of-time" means the provider's rate limit would
 * outlast `deadline` — the item is untouched and worth retrying later.
 */
export async function upgradeSummary(
  row: ItemRow,
  opts: { deadline?: number; write?: boolean } = {}
): Promise<UpgradeResult> {
  const stored = row.rawSnippet ?? "";
  const [sourceText] = await buildSummaryTexts([
    {
      title: row.title,
      snippet: stored,
      url: row.url,
      sourceName: row.sourceName,
      sourceType: row.sourceType,
      hasFullAbstract: stored.length >= MIN_SOURCE_CHARS,
    },
  ]);
  if (sourceText.length < MIN_SOURCE_CHARS) return { status: "no-source" };

  const item: RawItem = {
    title: row.title,
    authors: row.authors ?? undefined,
    snippet: sourceText,
    url: row.url,
    publishedAt: row.publishedAt ?? undefined,
    sourceName: row.sourceName,
    sourceType: row.sourceType,
  };
  const status: SummaryRunStatus = { exhausted: false };
  const summary = (await summarizeBatch([item], opts.deadline, status)).get(0);
  if (!summary) return { status: status.exhausted ? "out-of-time" : "failed" };

  if (opts.write !== false) {
    await db.update(items).set({ summary }).where(eq(items.id, row.id));
    // The feed serves the card, not the item row: refresh its text too.
    await client.execute({
      sql: "UPDATE cards SET body = ?, payload = json_set(payload, '$.takeaway', ?) WHERE item_id = ? AND type = 'paper'",
      args: [summary, firstSentence(summary), row.id],
    });
    await client.execute({ sql: "UPDATE search_index SET body = ? WHERE dedupe_key = ?", args: [summary, `news:${row.id}`] });
  }
  return {
    status: "upgraded",
    words: summary.trim().split(/\s+/).length,
    invented: inventedNumbers(summary, `${row.title} ${sourceText}`),
  };
}

/**
 * Upgrades as many fallback summaries as fit in the time budget. Run as a
 * background job; whatever it doesn't reach is picked up by the next run.
 */
export async function upgradeFallbackSummaries(budgetMs = 40_000, maxItems = 12): Promise<{ upgraded: number; remaining: number }> {
  const deadline = Date.now() + budgetMs;
  const rows = await listFallbackItems();
  let upgraded = 0;
  let tried = 0;
  for (const row of rows.slice(0, maxItems)) {
    if (Date.now() > deadline - 8000) break;
    tried++;
    const result = await upgradeSummary(row, { deadline });
    if (result.status === "upgraded") upgraded++;
    if (result.status === "out-of-time") break;
  }
  return { upgraded, remaining: Math.max(0, rows.length - tried) };
}

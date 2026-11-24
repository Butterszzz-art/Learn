// Decides what the shared pool needs next. Called by the cron tick, and
// (for one person's interests) right after onboarding or a settings change.
//
// The rule that keeps cost flat as users grow: work is queued per
// (interest, level) pair that has active readers — never per reader.
import { client } from "@/db";
import type { Level } from "@/db/schema";
import { enqueue, jobKey } from "./jobs";
import { hasPendingSeriesWrite, openBatchCount } from "./batchSeries";
import { hasSummaryLlm } from "../summaryLlm";
import { hasClaudeKey } from "../ai";
import { previousPeriod, findMonthlyDive, countMonthItems, MIN_MONTHLY_ITEMS } from "../monthly";

const ACTIVE_DAYS = 14;
const AHEAD_TARGET = 3; // unread series entries to keep ahead of the furthest reader
const AHEAD_TARGET_FAVORITE = 5;
const NEWS_HOURS_CURATED = 12; // free RSS/API fetch, summarized on the fast model
const NEWS_HOURS_ROUNDUP = 24; // web-searched, costs more
const EXPAND_PER_TICK = 10;
const DRILL_INTEREST_SLUGS = ["critical-thinking", "logic"];
// The Monthly Deep Dive on last month is written during the first days of
// the new month; after that, a month that was skipped stays skipped.
const MONTHLY_WINDOW_DAYS = 7;

function sqlTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export interface PlanResult {
  series: number;
  news: number;
  expand: number;
  drills: number;
  monthly: number;
}

/** Whether an interest's Monthly Deep Dive for `period` still needs writing. */
async function needsMonthly(interestId: number, period: string): Promise<boolean> {
  if (await findMonthlyDive(interestId, period)) return false;
  if ((await countMonthItems(interestId, period)) < MIN_MONTHLY_ITEMS) return false;
  // A job that already used up its retries isn't queued again every tick.
  const failed = await client.execute({
    sql: "SELECT 1 FROM jobs WHERE dedupe_key = ? AND status = 'failed' LIMIT 1",
    args: [jobKey("monthly_report", { interestId, period })],
  });
  return failed.rows.length === 0;
}

/**
 * Queues whatever the pool is short of. `userId` limits it to one person's
 * interests (used right after onboarding so their first content starts
 * generating immediately rather than at the next tick).
 */
export async function planWork(userId?: number): Promise<PlanResult> {
  const activeSince = sqlTime(new Date(Date.now() - ACTIVE_DAYS * 86400000));
  const result: PlanResult = { series: 0, news: 0, expand: 0, drills: 0, monthly: 0 };
  const now = new Date();
  const monthlyPeriod = now.getUTCDate() <= MONTHLY_WINDOW_DAYS ? previousPeriod(now) : null;

  // How far the furthest active reader has got in each (interest, level)
  // series, versus how many entries exist.
  const pairs = await client.execute({
    sql: `SELECT p.interest_id, p.level, MAX(p.is_favorite) AS fav,
                 (SELECT COUNT(*) FROM deep_dives d
                   WHERE d.interest_id = p.interest_id AND d.level = p.level
                     AND d.origin = 'syllabus' AND d.status = 'published') AS depth,
                 MAX((SELECT COUNT(DISTINCT c.deep_dive_id) FROM user_cards uc JOIN cards c ON c.id = uc.card_id
                       JOIN deep_dives d2 ON d2.id = c.deep_dive_id
                      WHERE uc.user_id = p.user_id AND d2.interest_id = p.interest_id
                        AND d2.level = p.level AND d2.origin = 'syllabus')) AS furthest
          FROM user_interest_prefs p
          JOIN users u ON u.id = p.user_id
          JOIN interests i ON i.id = p.interest_id
          WHERE p.enabled = 1 AND i.is_library_book = 0
            AND (u.last_active_at >= ? OR u.created_at >= ?)
            ${userId ? "AND p.user_id = ?" : ""}
          GROUP BY p.interest_id, p.level`,
    args: userId ? [activeSince, activeSince, userId] : [activeSince, activeSince],
  });
  for (const r of pairs.rows as any[]) {
    const ahead = Number(r.depth) - Number(r.furthest ?? 0);
    const target = Number(r.fav) ? AHEAD_TARGET_FAVORITE : AHEAD_TARGET;
    // An entry already being written in a batch counts as one ahead.
    const inFlight = (await hasPendingSeriesWrite(Number(r.interest_id), r.level as Level)) ? 1 : 0;
    if (ahead + inFlight < target) {
      await enqueue("series_next", { interestId: Number(r.interest_id), level: r.level as Level }, { userId: userId ?? null });
      result.series++;
    }
  }

  // News: once per followed interest, on a timer.
  const interestRows = await client.execute({
    sql: `SELECT i.id, i.slug, i.has_curated_source,
                 (SELECT MAX(fetched_at) FROM items WHERE interest_id = i.id) AS last_fetch
          FROM interests i
          WHERE i.is_library_book = 0 AND EXISTS (
            SELECT 1 FROM user_interest_prefs p JOIN users u ON u.id = p.user_id
            WHERE p.interest_id = i.id AND p.enabled = 1
              AND (u.last_active_at >= ? OR u.created_at >= ?) ${userId ? "AND p.user_id = ?" : ""})`,
    args: userId ? [activeSince, activeSince, userId] : [activeSince, activeSince],
  });
  for (const r of interestRows.rows as any[]) {
    const hours = Number(r.has_curated_source) ? NEWS_HOURS_CURATED : NEWS_HOURS_ROUNDUP;
    const stale = !r.last_fetch || r.last_fetch < sqlTime(new Date(Date.now() - hours * 3600000));
    if (stale) {
      await enqueue("news", { interestId: Number(r.id) });
      result.news++;
    }
    if (monthlyPeriod && (await needsMonthly(Number(r.id), monthlyPeriod))) {
      await enqueue("monthly_report", { interestId: Number(r.id), period: monthlyPeriod });
      result.monthly++;
    }
    if (DRILL_INTEREST_SLUGS.includes(r.slug)) {
      const recent = await client.execute({
        sql: `SELECT COUNT(*) AS n FROM cards WHERE interest_id = ? AND type = 'quiz' AND deep_dive_id IS NULL AND created_at >= ?`,
        args: [Number(r.id), sqlTime(new Date(Date.now() - 2 * 86400000))],
      });
      if (Number((recent.rows[0] as any)?.n ?? 0) === 0) {
        await enqueue("logic_drill", { interestId: Number(r.id) });
        result.drills++;
      }
    }
  }

  if (!userId) {
    // Publish anything whose batch has finished since the last tick.
    if ((await openBatchCount()) > 0) await enqueue("batch_collect", {});
    // News items saved with a truncated fallback summary get a proper one
    // when there is time (see summaryUpgrade.ts).
    if (hasSummaryLlm() || hasClaudeKey()) {
      const fallback = await client.execute("SELECT 1 FROM items WHERE summary LIKE '%…' AND raw_snippet IS NOT NULL LIMIT 1");
      if (fallback.rows.length > 0) await enqueue("upgrade_summaries", {});
    }
    // Deep dives written before launch have no cards yet. Expand the ones
    // readers can actually reach first.
    const unexpanded = await client.execute({
      sql: `SELECT d.id FROM deep_dives d
            WHERE d.expanded_at IS NULL AND d.status = 'published'
            ORDER BY EXISTS (SELECT 1 FROM user_interest_prefs p WHERE p.interest_id = d.interest_id AND p.enabled = 1) DESC,
                     d.seq ASC, d.id ASC
            LIMIT ?`,
      args: [EXPAND_PER_TICK],
    });
    for (const r of unexpanded.rows as any[]) {
      await enqueue("expand", { deepDiveId: Number(r.id) });
      result.expand++;
    }
    // Housekeeping: old finished jobs and old error rows.
    const monthAgo = sqlTime(new Date(Date.now() - 30 * 86400000));
    await client.execute({ sql: "DELETE FROM jobs WHERE status IN ('done','failed') AND created_at < ?", args: [monthAgo] });
    await client.execute({ sql: "DELETE FROM error_log WHERE created_at < ?", args: [monthAgo] });
    await client.execute({ sql: "DELETE FROM sessions WHERE expires_at < ?", args: [sqlTime(new Date())] });
  }
  return result;
}

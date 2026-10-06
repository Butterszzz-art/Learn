import { db, client } from "@/db";
import { brainGames } from "@/db/schema";
import type { BrainGameType } from "@/db/schema";
import { eq, isNull, asc } from "drizzle-orm";

export interface BrainGamePick {
  id: number;
  gameType: BrainGameType;
  content: string;
  answer: string;
}

/** The most recent Monday at 00:00 UTC, as a SQLite-comparable timestamp
 * string ("YYYY-MM-DD HH:MM:SS") — mirrors pipeline.ts's
 * currentWeekMondayLabel, kept local here since it's a two-line calculation
 * not worth a shared util for. */
function currentWeekMondayTimestamp(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - diffToMonday);
  return `${monday.toISOString().slice(0, 10)} 00:00:00`;
}

/**
 * Picks a handful of brain games not recently shown (prefers never-shown,
 * then least-recently-shown), and marks them as shown this week. Idempotent
 * within a single week (Phase 13 — Brain Games moved from daily to weekly
 * cadence, was "within a single day"), mirroring pickBrainFactOfTheDay's
 * daily version: if games were already picked this week, returns those same
 * ones rather than rotating again on every page load.
 */
export async function pickBrainGames(count = 3): Promise<BrainGamePick[]> {
  const weekStart = currentWeekMondayTimestamp();

  const alreadyThisWeekResult = await client.execute({
    sql: "SELECT id, game_type, content, answer FROM brain_games WHERE last_shown_at >= ? ORDER BY last_shown_at DESC LIMIT ?",
    args: [weekStart, count],
  });
  const alreadyThisWeek = alreadyThisWeekResult.rows as unknown as
    | { id: number; game_type: BrainGameType; content: string; answer: string }[]
    | undefined;
  if (alreadyThisWeek && alreadyThisWeek.length > 0) {
    return alreadyThisWeek.map((r) => ({ id: r.id, gameType: r.game_type, content: r.content, answer: r.answer }));
  }

  const neverShown = await db
    .select()
    .from(brainGames)
    .where(isNull(brainGames.lastShownAt))
    .orderBy(asc(brainGames.id))
    .limit(count);

  let picks = neverShown;
  if (picks.length < count) {
    const oldestShown = await db
      .select()
      .from(brainGames)
      .orderBy(asc(brainGames.lastShownAt))
      .limit(count - picks.length);
    const pickedIds = new Set(picks.map((p) => p.id));
    picks = [...picks, ...oldestShown.filter((p) => !pickedIds.has(p.id))];
  }
  if (picks.length === 0) return [];

  const now = new Date().toISOString();
  for (const p of picks) {
    await db.update(brainGames).set({ lastShownAt: now }).where(eq(brainGames.id, p.id));
  }

  return picks.map((p) => ({ id: p.id, gameType: p.gameType, content: p.content, answer: p.answer }));
}

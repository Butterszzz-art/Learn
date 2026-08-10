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

/**
 * Picks a handful of brain games not recently shown (prefers never-shown,
 * then least-recently-shown), and marks them as shown today. Idempotent
 * within a single day, mirroring pickBrainFactOfTheDay: if games were
 * already picked today, returns those same ones rather than rotating again
 * on every page load.
 */
export async function pickBrainGames(count = 3): Promise<BrainGamePick[]> {
  const today = new Date().toISOString().slice(0, 10);

  const alreadyTodayResult = await client.execute({
    sql: "SELECT id, game_type, content, answer FROM brain_games WHERE last_shown_at LIKE ? ORDER BY id LIMIT ?",
    args: [`${today}%`, count],
  });
  const alreadyToday = alreadyTodayResult.rows as unknown as
    | { id: number; game_type: BrainGameType; content: string; answer: string }[]
    | undefined;
  if (alreadyToday && alreadyToday.length > 0) {
    return alreadyToday.map((r) => ({ id: r.id, gameType: r.game_type, content: r.content, answer: r.answer }));
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

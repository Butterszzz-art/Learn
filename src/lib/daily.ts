// The daily set: a small, finite number of cards a day with a clear finish,
// after which the feed carries on for anyone who wants more.
import { client } from "@/db";
import type { UserPrefs } from "@/db/schema";
import { getStreak } from "./explore";
import { DEFAULT_DAILY_GOAL, dailyGoalFor } from "./dailyGoal";

export { DEFAULT_DAILY_GOAL, dailyGoalFor };

export interface DailyState {
  goal: number;
  seenToday: number; // cards shown so far today (UTC day, like the streak)
  activeToday: boolean;
  streak: number | null; // null unless the person opted in to a streak
}

export async function getDailyState(user: { id: number; prefs: UserPrefs }): Promise<DailyState> {
  const today = new Date().toISOString().slice(0, 10);
  const res = await client.execute({
    sql: "SELECT COUNT(*) AS n FROM user_cards WHERE user_id = ? AND seen_at >= ?",
    args: [user.id, today],
  });
  const seenToday = Number((res.rows[0] as any)?.n ?? 0);
  return {
    goal: dailyGoalFor(user.prefs),
    seenToday,
    activeToday: seenToday > 0,
    streak: user.prefs.streakOptIn ? await getStreak(user.id) : null,
  };
}

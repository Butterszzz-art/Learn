// Client-safe: the size of the daily set (see lib/daily.ts).
import type { UserPrefs } from "@/db/schema";

export const DEFAULT_DAILY_GOAL = 5;

/** Cards in today's set for these preferences; 0 means no daily set. */
export function dailyGoalFor(prefs: UserPrefs): number {
  return prefs.dailyGoal ?? DEFAULT_DAILY_GOAL;
}

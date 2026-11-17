// "Your week": a recap of the last seven days, built from what a person
// actually read, answered and remembered.
import { client } from "@/db";

export interface WeeklyRecap {
  cards: number;
  readingMinutes: number;
  newIdeas: string[]; // concepts first met this week (up to 12)
  newIdeaCount: number;
  quizAnswered: number;
  quizCorrect: number;
  guesses: number; // estimate and pick-a-side answers
  topField: { name: string; cards: number } | null;
  rabbitHole: { id: number; topic: string; minutes: number } | null; // the entry read longest
  activeDays: number;
}

const MAX_DWELL_MS = 10 * 60000;

export async function getWeeklyRecap(userId: number, now = Date.now()): Promise<WeeklyRecap> {
  const since = new Date(now - 7 * 86400000).toISOString();
  const [totals, ideas, field, hole, guesses] = await Promise.all([
    client.execute({
      sql: `SELECT COUNT(*) AS cards,
                   COALESCE(SUM(MIN(dwell_ms, ${MAX_DWELL_MS})), 0) AS dwell,
                   SUM(CASE WHEN answered_correct IS NOT NULL THEN 1 ELSE 0 END) AS answered,
                   SUM(CASE WHEN answered_correct = 1 THEN 1 ELSE 0 END) AS correct,
                   COUNT(DISTINCT substr(seen_at, 1, 10)) AS days
            FROM user_cards WHERE user_id = ? AND seen_at >= ?`,
      args: [userId, since],
    }),
    client.execute({
      sql: `SELECT c.name FROM user_concepts uc JOIN concepts c ON c.id = uc.concept_id
            WHERE uc.user_id = ? AND uc.first_seen_at >= ? ORDER BY uc.first_seen_at DESC`,
      args: [userId, since],
    }),
    client.execute({
      sql: `SELECT i.name, COUNT(*) AS n FROM user_cards uc JOIN interests i ON i.id = uc.interest_id
            WHERE uc.user_id = ? AND uc.seen_at >= ? GROUP BY uc.interest_id ORDER BY n DESC LIMIT 1`,
      args: [userId, since],
    }),
    client.execute({
      sql: `SELECT d.id, d.topic, SUM(MIN(uc.dwell_ms, ${MAX_DWELL_MS})) AS dwell
            FROM user_cards uc JOIN cards c ON c.id = uc.card_id JOIN deep_dives d ON d.id = c.deep_dive_id
            WHERE uc.user_id = ? AND uc.seen_at >= ? GROUP BY d.id ORDER BY dwell DESC LIMIT 1`,
      args: [userId, since],
    }),
    client.execute({ sql: "SELECT COUNT(*) AS n FROM card_responses WHERE user_id = ? AND created_at >= ?", args: [userId, since.slice(0, 19).replace("T", " ")] }),
  ]);
  const t = totals.rows[0] as any;
  const f = field.rows[0] as any;
  const h = hole.rows[0] as any;
  const ideaNames = (ideas.rows as any[]).map((r) => String(r.name));
  return {
    cards: Number(t?.cards ?? 0),
    readingMinutes: Math.round(Number(t?.dwell ?? 0) / 60000),
    newIdeas: ideaNames.slice(0, 12),
    newIdeaCount: ideaNames.length,
    quizAnswered: Number(t?.answered ?? 0),
    quizCorrect: Number(t?.correct ?? 0),
    guesses: Number((guesses.rows[0] as any)?.n ?? 0),
    topField: f ? { name: String(f.name), cards: Number(f.n) } : null,
    // Only worth calling a rabbit hole past a couple of minutes.
    rabbitHole: h && Number(h.dwell) >= 120000 ? { id: Number(h.id), topic: String(h.topic), minutes: Math.round(Number(h.dwell) / 60000) } : null,
    activeDays: Number(t?.days ?? 0),
  };
}

/** A short plain-text version for sharing. Nothing private beyond the numbers. */
export function recapShareText(r: WeeklyRecap): string {
  const parts = [`This week on Neuron: ${r.cards} cards, ${r.newIdeaCount} new idea${r.newIdeaCount === 1 ? "" : "s"}`];
  if (r.quizAnswered > 0) parts.push(`${Math.round((r.quizCorrect / r.quizAnswered) * 100)}% on quick checks`);
  if (r.rabbitHole) parts.push(`deepest rabbit hole: ${r.rabbitHole.topic}`);
  return parts.join(" · ") + ".";
}

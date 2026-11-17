// Answers to interactive cards (estimate guesses, debate sides) and the
// "what other readers said" numbers built from them.
import { client } from "@/db";
import type { CrowdStats } from "./cardTypes";
import { median } from "./metrics";

/** Below this many other answers the crowd line is not shown: too easy to read too much into. */
export const MIN_CROWD = 5;

/** Pure: summary of everyone's answers to one card. */
export function summarizeResponses(kind: "estimate" | "debate", values: number[], answer?: number): CrowdStats {
  const n = values.length;
  if (kind === "debate") {
    return { responses: n, agreeShare: n ? values.filter((v) => v >= 0.5).length / n : null };
  }
  const within =
    n && answer !== undefined && answer !== 0 ? values.filter((v) => Math.abs(v - answer) / Math.abs(answer) <= 0.25).length / n : null;
  return { responses: n, medianGuess: median(values), withinQuarter: within };
}

/**
 * Records a person's answer (first answer wins, so nobody can peek and
 * re-answer) and returns the crowd's answers including theirs.
 */
export async function respondToCard(userId: number, cardId: number, value: number): Promise<{ crowd: CrowdStats; kind: string } | null> {
  const cardRes = await client.execute({ sql: "SELECT type, payload FROM cards WHERE id = ? AND status = 'published'", args: [cardId] });
  const card = cardRes.rows[0] as any;
  if (!card || (card.type !== "estimate" && card.type !== "debate")) return null;
  const kind = card.type as "estimate" | "debate";
  const v = kind === "debate" ? (value >= 0.5 ? 1 : 0) : value;
  await client.execute({
    sql: "INSERT OR IGNORE INTO card_responses (user_id, card_id, value) VALUES (?, ?, ?)",
    args: [userId, cardId, v],
  });
  const all = await client.execute({ sql: "SELECT value FROM card_responses WHERE card_id = ? LIMIT 5000", args: [cardId] });
  let answer: number | undefined;
  try {
    answer = kind === "estimate" ? Number(JSON.parse(card.payload).answer) : undefined;
  } catch {}
  const crowd = summarizeResponses(kind, (all.rows as any[]).map((r) => Number(r.value)), answer);
  return { crowd, kind };
}

// The in-depth length of a bite card. New bites get it from the expansion
// step; bites written before that existed get it here, the first time any
// reader asks for it, and it is then stored on the card for everyone (the
// card pool is shared, so this costs one call per card, not per reader).
import { client } from "@/db";
import { generateJson, hasClaudeKey, withAiContext } from "../ai";

const SCHEMA = {
  type: "object",
  properties: {
    detail: {
      type: "string",
      description:
        "220-350 words in 2-4 short paragraphs separated by a blank line. Explains the card's idea in depth: " +
        "the mechanism step by step, the evidence the entry gives for it, a worked example, and any caveat or " +
        "open question the entry raises.",
    },
  },
  required: ["detail"],
  additionalProperties: false,
} as const;

const SYSTEM =
  "You write the in-depth version of a learning app's feed card from the long-form entry it came from. " +
  "Everything must be faithful to the entry: never add a fact, number or claim that is not in it. Write " +
  "plainly and precisely for a curious adult; never talk down, never hype. No headings, no bullet lists.";

const inFlight = new Map<number, Promise<string | null>>();

/** Returns the bite's in-depth text, writing and storing it if it doesn't exist yet. */
export async function getBiteDetail(cardId: number): Promise<string | null> {
  const res = await client.execute({
    sql: `SELECT c.title, c.body, c.payload, c.level, d.content, d.topic
          FROM cards c LEFT JOIN deep_dives d ON d.id = c.deep_dive_id
          WHERE c.id = ? AND c.type = 'bite' AND c.status = 'published'`,
    args: [cardId],
  });
  const row = res.rows[0] as any;
  if (!row) return null;
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(String(row.payload || "{}"));
  } catch {}
  if (typeof payload.detail === "string" && payload.detail.trim()) return payload.detail;
  if (!row.content || !hasClaudeKey()) return null;

  const pending = inFlight.get(cardId);
  if (pending) return pending;
  const job = withAiContext({ userId: null, purpose: "bite_detail" }, async () => {
    const out = await generateJson<{ detail: string }>({
      tier: "fast",
      schema: SCHEMA as unknown as Record<string, unknown>,
      system: SYSTEM,
      maxTokens: 1500,
      prompt:
        `Entry topic: "${row.topic}"\nReader level: ${row.level ?? "some_background"}\n\n` +
        `--- ENTRY ---\n${row.content}\n--- END ENTRY ---\n\n` +
        `The feed card:\nHeadline: ${row.title}\nText: ${row.body}\n\n` +
        "Write the in-depth version of this card, covering the same idea in more depth using only the entry.",
    });
    const detail = out?.detail?.trim();
    if (!detail) return null;
    payload.detail = detail;
    await client.execute({ sql: "UPDATE cards SET payload = ? WHERE id = ?", args: [JSON.stringify(payload), cardId] });
    return detail;
  }).finally(() => inFlight.delete(cardId));
  inFlight.set(cardId, job);
  return job;
}

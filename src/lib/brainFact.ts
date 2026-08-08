import { db, client } from "@/db";
import { brainFacts, settings } from "@/db/schema";
import { eq, isNull, asc } from "drizzle-orm";
import { generateCandidateBrainFacts, hasClaudeKey } from "./claude";

const WEEKLY_GEN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Picks a Brain Fact of the Day not recently shown (prefers never-shown
 * facts, then the least-recently-shown), and marks it as shown today.
 * Idempotent within a single day: if a fact was already picked today, it
 * returns that same fact rather than rotating again.
 */
export async function pickBrainFactOfTheDay(): Promise<
  { id: number; text: string; topic: string | null } | null
> {
  const today = new Date().toISOString().slice(0, 10);

  const alreadyTodayResult = await client.execute({
    sql: "SELECT id, text, topic FROM brain_facts WHERE last_shown_at LIKE ? ORDER BY id LIMIT 1",
    args: [`${today}%`],
  });
  const alreadyToday = alreadyTodayResult.rows[0] as unknown as
    | { id: number; text: string; topic: string | null }
    | undefined;
  if (alreadyToday) return alreadyToday;

  const neverShown = await db
    .select()
    .from(brainFacts)
    .where(isNull(brainFacts.lastShownAt))
    .orderBy(asc(brainFacts.id))
    .limit(1);

  let candidate = neverShown[0];
  if (!candidate) {
    const oldestShown = await db
      .select()
      .from(brainFacts)
      .orderBy(asc(brainFacts.lastShownAt))
      .limit(1);
    candidate = oldestShown[0];
  }
  if (!candidate) return null;

  await db
    .update(brainFacts)
    .set({ lastShownAt: new Date().toISOString() })
    .where(eq(brainFacts.id, candidate.id));

  return { id: candidate.id, text: candidate.text, topic: candidate.topic };
}

/**
 * If it's been at least a week since the last generation run (and an
 * Anthropic key is configured), asks Claude for a handful of new candidate
 * facts, plausibility-checks them, and appends survivors to the bank. Safe
 * to call on every refresh — it no-ops most of the time.
 */
export async function maybeGenerateWeeklyFacts(): Promise<number> {
  if (!hasClaudeKey()) return 0;

  const currentRows = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  const current = currentRows[0];
  const lastGen = current?.lastFactGenAt ? new Date(current.lastFactGenAt).getTime() : 0;
  if (Date.now() - lastGen < WEEKLY_GEN_INTERVAL_MS) return 0;

  const sampleRows = await db
    .select({ text: brainFacts.text })
    .from(brainFacts)
    .orderBy(asc(brainFacts.id))
    .limit(40); // keep the prompt bounded

  const candidates = await generateCandidateBrainFacts(
    sampleRows.map((r) => r.text),
    8
  );

  let inserted = 0;
  if (candidates.length > 0) {
    const existingRows = await db.select({ text: brainFacts.text }).from(brainFacts);
    const existingTexts = new Set(existingRows.map((r) => r.text));
    for (const c of candidates) {
      if (existingTexts.has(c.text)) continue;
      await db.insert(brainFacts).values({ text: c.text, topic: c.topic, source: "generated" });
      inserted++;
    }
  }

  await db
    .update(settings)
    .set({ lastFactGenAt: new Date().toISOString() })
    .where(eq(settings.id, 1));
  return inserted;
}

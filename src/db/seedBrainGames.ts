// Seeds the static/randomized brain games bank. Idempotent — matches by
// content text, so re-running only adds genuinely new entries.
import { db, client } from "./index";
import { brainGames } from "./schema";
import { BRAIN_GAMES_SEED } from "./brainGamesSeed";

export async function seedBrainGames(): Promise<number> {
  const existingRows = await client.execute("SELECT content FROM brain_games");
  const existing = new Set(existingRows.rows.map((r: any) => r.content as string));

  let inserted = 0;
  for (const game of BRAIN_GAMES_SEED) {
    if (existing.has(game.content)) continue;
    // Track locally, not just in the DB snapshot fetched above — two of the
    // procedurally-generated games can coincidentally produce identical
    // content text (this actually happened: one duplicate arithmetic
    // problem), and without this they'd both pass the check above.
    existing.add(game.content);
    try {
      await db.insert(brainGames).values({
        gameType: game.gameType,
        content: game.content,
        answer: game.answer,
      });
      inserted++;
    } catch (err) {
      // See seedInterests.ts's comment on this pattern. brain_games.content
      // has a UNIQUE index (migrate.ts) for the same reason mental_models.name
      // does — without one, a concurrent-seeding race silently duplicates
      // rows instead of erroring, which is what actually happened.
      const message = err instanceof Error ? err.message : String(err);
      if (!/unique constraint failed/i.test(message)) throw err;
    }
  }
  return inserted;
}

const isMain = process.argv[1]?.endsWith("seedBrainGames.ts");
if (isMain) {
  seedBrainGames()
    .then((n) => console.log(`Seeded ${n} new brain games.`))
    .catch((err) => {
      console.error("Seeding brain games failed:", err);
      process.exit(1);
    });
}

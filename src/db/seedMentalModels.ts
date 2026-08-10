// Seeds the cross-cutting mental models library. Idempotent — matches by
// name, so re-running only adds genuinely new entries.
import { db, client } from "./index";
import { mentalModels } from "./schema";
import { MENTAL_MODELS_SEED } from "./mentalModelsSeed";

export async function seedMentalModels(): Promise<number> {
  const existingRows = await client.execute("SELECT name FROM mental_models");
  const existing = new Set(existingRows.rows.map((r: any) => r.name as string));

  let inserted = 0;
  for (const model of MENTAL_MODELS_SEED) {
    if (existing.has(model.name)) continue;
    // Track locally, not just in the DB snapshot fetched above — otherwise
    // two identical names within MENTAL_MODELS_SEED itself (a data bug, not
    // a concurrency one) would both pass this check and both attempt to
    // insert, relying entirely on the UNIQUE index below to catch it.
    existing.add(model.name);
    try {
      await db.insert(mentalModels).values({
        name: model.name,
        category: model.category,
        description: model.description,
      });
      inserted++;
    } catch (err) {
      // Same concurrent-seeding race as seedInterests.ts — see that file's
      // comment. mental_models.name has a UNIQUE index (migrate.ts) for
      // exactly this reason: without one, two build workers racing this
      // same check-then-insert sequence would silently duplicate every row
      // instead of erroring — which is what actually happened before that
      // index existed. Caught here and treated as "already exists".
      const message = err instanceof Error ? err.message : String(err);
      if (!/unique constraint failed/i.test(message)) throw err;
    }
  }
  return inserted;
}

const isMain = process.argv[1]?.endsWith("seedMentalModels.ts");
if (isMain) {
  seedMentalModels()
    .then((n) => console.log(`Seeded ${n} new mental models.`))
    .catch((err) => {
      console.error("Seeding mental models failed:", err);
      process.exit(1);
    });
}

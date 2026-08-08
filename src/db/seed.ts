// Seeds the brain_facts table from the curated bank. Safe to re-run: it only
// inserts facts whose exact text isn't already present.
import { db, client } from "./index";
import { runMigrations } from "./migrate";
import { brainFacts } from "./schema";
import { BRAIN_FACTS_SEED } from "./brainFactsSeed";

export async function seedBrainFacts(): Promise<number> {
  await runMigrations();

  const existingRows = await client.execute("SELECT text FROM brain_facts");
  const existing = new Set(existingRows.rows.map((row: any) => row.text as string));

  let inserted = 0;
  for (const fact of BRAIN_FACTS_SEED) {
    if (existing.has(fact.text)) continue;
    await db.insert(brainFacts).values({ text: fact.text, topic: fact.topic, source: "seed" });
    inserted++;
  }
  return inserted;
}

const isMain = process.argv[1]?.endsWith("seed.ts");
if (isMain) {
  seedBrainFacts()
    .then((n) => {
      console.log(`Seeded ${n} new brain facts (bank now has ${BRAIN_FACTS_SEED.length} curated entries).`);
    })
    .catch((err) => {
      console.error("Seeding failed:", err);
      process.exit(1);
    });
}

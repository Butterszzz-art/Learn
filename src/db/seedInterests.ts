// Seeds the interests catalog, and backfills Phase 1's pre-existing items
// (which predate the interests system) onto the Neuroscience interest so
// they don't silently vanish from the feed. Both steps are idempotent.
import { db, client } from "./index";
import { interests } from "./schema";
import { INTERESTS_SEED } from "./interestsSeed";

export async function seedInterests(): Promise<number> {
  const existingRows = await client.execute("SELECT slug FROM interests");
  const existing = new Set(existingRows.rows.map((r: any) => r.slug as string));

  let inserted = 0;
  for (const interest of INTERESTS_SEED) {
    if (existing.has(interest.slug)) continue;
    try {
      await db.insert(interests).values({
        slug: interest.slug,
        name: interest.name,
        description: interest.description,
        hasCuratedSource: interest.hasCuratedSource,
        isCustom: false,
        generatesAppliedInsights: interest.generatesAppliedInsights,
      });
      inserted++;
    } catch (err) {
      // Same class of race as migrate.ts's ADDITIVE_COLUMNS loop: against a
      // hosted Turso database, multiple processes (next build's parallel
      // workers, or two serverless cold starts right after a fresh deploy)
      // can both fetch the existing-slugs snapshot before either commits an
      // insert, so both attempt to add a brand-new interest. A UNIQUE
      // constraint violation on slug unambiguously means another process
      // already added it — treat that as success, not a failure.
      const message = err instanceof Error ? err.message : String(err);
      if (!/unique constraint failed/i.test(message)) throw err;
    }
  }

  await backfillNeuroscienceInterest();
  return inserted;
}

async function backfillNeuroscienceInterest() {
  const rows = await client.execute({
    sql: "SELECT id FROM interests WHERE slug = ?",
    args: ["neuroscience"],
  });
  const neuroId = (rows.rows[0] as any)?.id;
  if (!neuroId) return;
  await client.execute({
    sql: "UPDATE items SET interest_id = ? WHERE interest_id IS NULL",
    args: [neuroId],
  });
}

const isMain = process.argv[1]?.endsWith("seedInterests.ts");
if (isMain) {
  seedInterests()
    .then((n) => console.log(`Seeded ${n} new interests.`))
    .catch((err) => {
      console.error("Seeding interests failed:", err);
      process.exit(1);
    });
}

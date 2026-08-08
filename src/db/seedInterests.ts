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
    await db.insert(interests).values({
      slug: interest.slug,
      name: interest.name,
      description: interest.description,
      hasCuratedSource: interest.hasCuratedSource,
    });
    inserted++;
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

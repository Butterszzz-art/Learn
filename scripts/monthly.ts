// Writes Monthly Deep Dives by hand, without waiting for the scheduler's
// first-week-of-the-month window. Runs against the same database as `tick`.
//
//   npm run monthly -- --slug neuroscience                 last month, one field
//   npm run monthly -- --slug neuroscience --period 2026-11
//   npm run monthly -- --all --period 2026-10              every field with enough items
import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local" });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { ensureDb } = await import("../src/db/bootstrap");
  const { client } = await import("../src/db");
  const { withAiContext } = await import("../src/lib/ai");
  const { generateMonthlyDeepDive, previousPeriod, isPeriod, countMonthItems, MIN_MONTHLY_ITEMS } = await import("../src/lib/monthly");
  await ensureDb();

  const period = arg("period") ?? previousPeriod();
  if (!isPeriod(period)) throw new Error(`--period must look like 2026-10, got ${period}`);
  const slug = arg("slug");
  if (!slug && !process.argv.includes("--all")) throw new Error("Pass --slug <interest> or --all");

  const res = await client.execute({
    sql: `SELECT id, slug, name FROM interests WHERE is_library_book = 0 ${slug ? "AND slug = ?" : ""} ORDER BY id`,
    args: slug ? [slug] : [],
  });
  if (res.rows.length === 0) throw new Error(`No interest with slug ${slug}`);

  for (const r of res.rows as any[]) {
    const n = await countMonthItems(Number(r.id), period);
    if (n < MIN_MONTHLY_ITEMS) {
      console.log(`${r.slug}: ${n} items in ${period}, skipping (need ${MIN_MONTHLY_ITEMS})`);
      continue;
    }
    console.log(`${r.slug}: writing from ${n} items…`);
    const out = await withAiContext({ userId: null, purpose: "monthly_report" }, () => generateMonthlyDeepDive(Number(r.id), period));
    console.log(`${r.slug}:`, out ?? "generation failed");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

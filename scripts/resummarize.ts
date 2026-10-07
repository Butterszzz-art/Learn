// One-off backfill: re-summarize items still carrying the truncated fallback
// summary (raw snippet cut at ~300 chars, ending in "…") using the current
// summary provider and length target. Items with a stored abstract use it;
// items with only a short RSS snippet get their article page fetched. Each
// summary is written as soon as it's generated, so the run is safe to stop
// and re-run (it only touches items that still end in "…").
//
// Usage: npm run resummarize            (all eligible items)
//        npm run resummarize -- --dry   (print what would change, write nothing)
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { ensureDb } from "../src/db/bootstrap";
import { hasSummaryLlm } from "../src/lib/summaryLlm";
import { listFallbackItems, upgradeSummary } from "../src/lib/summaryUpgrade";

async function main() {
  const dry = process.argv.includes("--dry");
  if (!hasSummaryLlm()) {
    console.error("SUMMARY_LLM_API_KEY is not set — refusing to run (the Anthropic path may be out of credit).");
    process.exit(1);
  }
  await ensureDb();

  const rows = await listFallbackItems();
  console.log(`${rows.length} fallback-summary items to process.`);

  let updated = 0;
  let noSource = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i++) {
    const label = `[${i + 1}/${rows.length}] ${rows[i].title.slice(0, 70)}`;
    const result = await upgradeSummary(rows[i], { write: !dry });
    if (result.status === "upgraded") {
      const flag = result.invented.length ? "  NUMBERS NOT IN SOURCE: " + result.invented.join(", ") : "";
      console.log(`${label} — ${result.words} words${flag}`);
      updated++;
    } else if (result.status === "no-source") {
      console.log(`${label} — skipped (no usable source text)`);
      noSource++;
    } else {
      console.log(`${label} — FAILED (kept old)`);
      failed++;
    }
  }
  console.log(
    dry
      ? "Dry run — nothing written."
      : `Updated ${updated}/${rows.length}. Skipped (no usable source): ${noSource}. Failed: ${failed}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Re-summarizes news items that still carry the truncated fallback summary
// (saved when the summary provider ran out of time or was unavailable).
//
//   npm run resummarize            write upgraded summaries
//   npm run resummarize -- --dry   report what would change, write nothing
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const dry = process.argv.includes("--dry");
  const { ensureDb } = await import("../src/db/bootstrap");
  const { hasSummaryLlm } = await import("../src/lib/summaryLlm");
  const { hasClaudeKey } = await import("../src/lib/ai");
  const { listFallbackItems, upgradeSummary } = await import("../src/lib/summaryUpgrade");
  if (!hasSummaryLlm() && !hasClaudeKey()) {
    console.error("Neither SUMMARY_LLM_API_KEY nor ANTHROPIC_API_KEY is set — nothing to summarize with.");
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
  console.log(dry ? "Dry run — nothing written." : `Updated ${updated}/${rows.length}. Skipped (no usable source): ${noSource}. Failed: ${failed}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

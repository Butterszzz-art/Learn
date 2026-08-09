// Standalone fetch-and-compile script, meant to be run outside the web
// server (e.g. from cron or Windows Task Scheduler) so the feed can be
// refreshed hands-off every morning. Equivalent to clicking "Refresh now"
// in the UI. See the README for scheduling instructions.
//
// Usage: npm run fetch
import "dotenv/config";
import { ensureDb } from "../src/db/bootstrap";
import { runDigestPipeline } from "../src/lib/pipeline";

async function main() {
  await ensureDb();
  console.log(`[${new Date().toISOString()}] Starting fetch-and-compile…`);
  const result = await runDigestPipeline();

  if (result.enabledInterestCount === 0) {
    console.log("No interests are enabled yet — visit the app and complete onboarding first.");
    return;
  }

  console.log(
    `Cycle #${result.cycleId}: +${result.newsAdded} news items ` +
      `(fetched ${result.fetchedCount} across ${result.enabledInterestCount} interests), ` +
      `+${result.deepDivesAdded} deep dives, +${result.appliedInsightsAdded} applied insights, ` +
      `+${result.drillsAdded} drills, using ${result.usedClaude ? "Claude" : "keyword fallback"}.`
  );
  if (!result.usedClaude) {
    console.log(
      "No ANTHROPIC_API_KEY set — deep dives, applied insights, and roundup-only interests were " +
        "skipped; curated items still work."
    );
  }
  if (result.newBrainFacts > 0) {
    console.log(`Added ${result.newBrainFacts} new brain facts to the bank.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fetch-and-compile failed:", err);
    process.exit(1);
  });

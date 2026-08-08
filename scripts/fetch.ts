// Standalone fetch-and-compile script, meant to be run outside the web
// server (e.g. from cron or Windows Task Scheduler) so the digest can be
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

  if (result.noNewItems) {
    console.log(
      `No new items found (checked ${result.fetchedCount} fetched, ${result.newItemCount} new).` +
        (result.digestId > 0 ? ` Latest digest is #${result.digestId}.` : " No digest exists yet.")
    );
  } else {
    console.log(
      `Compiled digest #${result.digestId}: ${result.itemCount} items ` +
        `(fetched ${result.fetchedCount}, ${result.newItemCount} new) ` +
        `using ${result.usedClaude ? "Claude" : "keyword fallback"}.`
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

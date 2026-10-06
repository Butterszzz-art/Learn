// Standalone fetch-and-compile script, meant to be run outside the web
// server (e.g. from cron or Windows Task Scheduler) so the feed can be
// refreshed hands-off every morning. Equivalent to clicking "Refresh now"
// in the UI. See the README for scheduling instructions.
//
// Usage: npm run fetch
//
// Env loading: `@next/env` (the same package `next dev`/`next build` use
// internally) rather than bare `dotenv/config` — plain dotenv only reads
// `.env`, so ANTHROPIC_API_KEY and friends kept in `.env.local` (this
// project's actual convention, see .env.example) were silently invisible to
// this script even though the Next dev server picked them up fine.
// loadEnvConfig reproduces Next's real precedence: .env.local overrides
// .env, both get merged in, and any value already set in the real process
// environment always wins over either file.
//
// This runs BEFORE the app modules below are imported, and deliberately via
// dynamic import() rather than a top-of-file `import … from`: static imports
// are hoisted and evaluated before any of this file's own code (per ES
// module semantics), which would run src/lib/claude.ts's top-level
// `process.env.ANTHROPIC_MODEL` read too early and lock in a stale default.
// Dynamic import() only evaluates its target at the point it's actually
// called, so loadEnvConfig has already populated process.env by then.
import { loadEnvConfig } from "@next/env";

async function main() {
  loadEnvConfig(process.cwd());
  const { ensureDb } = await import("../src/db/bootstrap");
  const { runDigestPipeline } = await import("../src/lib/pipeline");

  await ensureDb();
  console.log(`[${new Date().toISOString()}] Starting fetch-and-compile…`);
  const result = await runDigestPipeline();

  if (result.enabledInterestCount === 0) {
    console.log("No interests are enabled yet — visit the app and complete onboarding first.");
    return;
  }

  console.log(
    `Daily cycle #${result.dailyCycleId} / Weekly cycle #${result.weeklyCycleId}: ` +
      `+${result.newsAdded} news items (fetched ${result.fetchedCount} across ${result.enabledInterestCount} interests), ` +
      `+${result.deepDivesAdded} deep dives, +${result.appliedInsightsAdded} applied insights, ` +
      `+${result.drillsAdded} drills, +${result.steelmansAdded} steelmans, ` +
      `+${result.mentalModelsAdded} mental models, +${result.rabbitHolesAdded} rabbit holes, ` +
      `using ${result.usedClaude ? "Claude" : "keyword fallback"}.`
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

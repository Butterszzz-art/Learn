// Runs one scheduler tick from the command line: decides what the shared
// content pool needs, then works through the queue. Same thing the
// /api/cron/tick endpoint does, without an HTTP time limit — useful for
// filling the pool before launch.
//
//   npm run tick                 plan + drain for up to 10 minutes
//   npm run tick -- --minutes 30 a longer run
//   npm run tick -- --plan-only  queue work without running it
import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const args = process.argv.slice(2);
  const minutesArg = args.indexOf("--minutes");
  const minutes = minutesArg >= 0 ? Number(args[minutesArg + 1]) || 10 : 10;
  const planOnly = args.includes("--plan-only");

  const { ensureDb } = await import("../src/db/bootstrap");
  const { planWork } = await import("../src/lib/engine/scheduler");
  const { drain, pendingJobCount } = await import("../src/lib/engine/jobs");
  const { usingHostedDb } = await import("../src/db");

  console.log(`Database: ${usingHostedDb ? "hosted (Turso)" : "local file"}`);
  await ensureDb();
  const planned = await planWork();
  console.log("Queued:", planned);
  if (planOnly) return;
  const ran = await drain(minutes * 60000);
  console.log(`Ran ${ran} job(s). ${await pendingJobCount()} still waiting.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

// Ensures the schema exists and the brain-fact bank is seeded. Safe to call
// from every request — after the first call in a process it's a no-op.
import { runMigrations } from "./migrate";
import { seedBrainFacts } from "./seed";
import { seedInterests } from "./seedInterests";

let bootstrapPromise: Promise<void> | null = null;

export function ensureDb(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await runMigrations();
      await seedInterests(); // must run before seedBrainFacts backfills anything interest-dependent
      await seedBrainFacts();
    })().catch((err) => {
      // Allow a retry on the next call if bootstrap failed.
      bootstrapPromise = null;
      throw err;
    });
  }
  return bootstrapPromise;
}

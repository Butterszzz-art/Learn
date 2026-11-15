// Makes sure the schema exists, the curated banks are seeded, and the
// no-AI starter content is in the card pool. After the first call in a
// process this is a resolved promise, so calling it per request is free.
import { runMigrations } from "./migrate";
import { seedBrainFacts } from "./seed";
import { seedInterests } from "./seedInterests";
import { seedMentalModels } from "./seedMentalModels";
import { seedBrainGames } from "./seedBrainGames";

let bootstrapPromise: Promise<void> | null = null;

export function ensureDb(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await runMigrations();
      await seedInterests(); // before anything interest-dependent
      await seedBrainFacts();
      await seedMentalModels();
      await seedBrainGames();
      // Imported lazily: it pulls in the content engine, which the plain
      // `npm run db:migrate` script doesn't need.
      const { bootstrapContent } = await import("@/lib/engine/bootstrapContent");
      await bootstrapContent();
    })().catch((err) => {
      bootstrapPromise = null; // allow a retry on the next call
      throw err;
    });
  }
  return bootstrapPromise;
}

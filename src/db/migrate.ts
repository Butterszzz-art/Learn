// Applies the schema directly via raw SQL (idempotent CREATE TABLE IF NOT
// EXISTS statements) rather than depending on drizzle-kit's generated
// migration journal. This keeps `npm run db:migrate` self-contained and safe
// to re-run on every startup.
import { client, usingHostedDb } from "./index";
import { INTERESTS_SEED } from "./interestsSeed";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS brain_facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    topic TEXT,
    source TEXT NOT NULL DEFAULT 'seed',
    last_shown_at TEXT,
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  );`,
  `CREATE TABLE IF NOT EXISTS digests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_label TEXT NOT NULL,
    frequency TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (current_timestamp),
    brain_fact_id INTEGER REFERENCES brain_facts(id)
  );`,
  `CREATE TABLE IF NOT EXISTS interests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    has_curated_source INTEGER NOT NULL DEFAULT 0,
    is_custom INTEGER NOT NULL DEFAULT 0,
    generates_applied_insights INTEGER NOT NULL DEFAULT 0
  );`,
  `CREATE TABLE IF NOT EXISTS user_interests (
    interest_id INTEGER PRIMARY KEY REFERENCES interests(id),
    level TEXT NOT NULL DEFAULT 'some_background',
    enabled INTEGER NOT NULL DEFAULT 1
  );`,
  `CREATE TABLE IF NOT EXISTS covered_topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    interest_id INTEGER NOT NULL REFERENCES interests(id),
    topic TEXT NOT NULL,
    date_covered TEXT NOT NULL DEFAULT (current_timestamp)
  );`,
  `CREATE TABLE IF NOT EXISTS deep_dives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    interest_id INTEGER NOT NULL REFERENCES interests(id),
    topic TEXT NOT NULL,
    content TEXT NOT NULL,
    sources TEXT NOT NULL DEFAULT '[]',
    level TEXT NOT NULL,
    digest_id INTEGER REFERENCES digests(id),
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  );`,
  // Phase 5 — critical-thinking/logic practice items.
  `CREATE TABLE IF NOT EXISTS drills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    interest_id INTEGER NOT NULL REFERENCES interests(id),
    source_deep_dive_id INTEGER REFERENCES deep_dives(id),
    drill_type TEXT NOT NULL,
    prompt_content TEXT NOT NULL,
    options TEXT NOT NULL DEFAULT '[]',
    correct_option INTEGER NOT NULL,
    explanation TEXT NOT NULL,
    concept_label TEXT NOT NULL,
    digest_id INTEGER REFERENCES digests(id),
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  );`,
  // category is nullable here (Phase 2) — see rebuildItemsTableIfNeeded()
  // below for the migration path from Phase 1's NOT NULL version.
  `CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    authors TEXT,
    summary TEXT NOT NULL,
    raw_snippet TEXT,
    source_name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    category TEXT,
    interest_id INTEGER REFERENCES interests(id),
    url TEXT NOT NULL,
    dedupe_key TEXT NOT NULL,
    published_at TEXT,
    fetched_at TEXT NOT NULL DEFAULT (current_timestamp),
    score REAL NOT NULL DEFAULT 0,
    digest_id INTEGER REFERENCES digests(id)
  );`,
  `CREATE TABLE IF NOT EXISTS applied_insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    interest_id INTEGER NOT NULL REFERENCES interests(id),
    deep_dive_id INTEGER REFERENCES deep_dives(id),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  );`,
  `CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    frequency TEXT NOT NULL DEFAULT 'daily',
    muted_categories TEXT NOT NULL DEFAULT '[]',
    last_refresh_at TEXT,
    last_fact_gen_at TEXT
  );`,
  // Note: items_* indexes are created after rebuildItemsTableIfNeeded() runs
  // below, not here — on an existing Phase 1 DB, `items` doesn't have
  // interest_id yet at this point in the migration.
  `CREATE INDEX IF NOT EXISTS brain_facts_last_shown_idx ON brain_facts(last_shown_at);`,
  `CREATE INDEX IF NOT EXISTS covered_topics_interest_idx ON covered_topics(interest_id);`,
  `CREATE INDEX IF NOT EXISTS deep_dives_digest_idx ON deep_dives(digest_id);`,
  `CREATE INDEX IF NOT EXISTS applied_insights_deep_dive_idx ON applied_insights(deep_dive_id);`,
  `CREATE INDEX IF NOT EXISTS applied_insights_interest_idx ON applied_insights(interest_id);`,
  `CREATE INDEX IF NOT EXISTS drills_interest_idx ON drills(interest_id);`,
  `CREATE INDEX IF NOT EXISTS drills_digest_idx ON drills(digest_id);`,
  `CREATE INDEX IF NOT EXISTS drills_source_dive_idx ON drills(source_deep_dive_id);`,
  `INSERT OR IGNORE INTO settings (id, frequency, muted_categories) VALUES (1, 'daily', '[]');`,
];

// Columns added after the initial release — applied via ALTER TABLE, guarded
// so re-running against a DB that already has them is a harmless no-op.
const ADDITIVE_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: "settings", column: "last_fact_gen_at", ddl: "ALTER TABLE settings ADD COLUMN last_fact_gen_at TEXT;" },
  {
    table: "interests",
    column: "is_custom",
    ddl: "ALTER TABLE interests ADD COLUMN is_custom INTEGER NOT NULL DEFAULT 0;",
  },
  {
    table: "interests",
    column: "generates_applied_insights",
    ddl: "ALTER TABLE interests ADD COLUMN generates_applied_insights INTEGER NOT NULL DEFAULT 0;",
  },
  // --- Phase 4: curiosity branching, Passion Mode, retention tools ---
  {
    table: "interests",
    column: "is_favorite",
    ddl: "ALTER TABLE interests ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;",
  },
  {
    table: "deep_dives",
    column: "follow_up_topics",
    ddl: "ALTER TABLE deep_dives ADD COLUMN follow_up_topics TEXT NOT NULL DEFAULT '[]';",
  },
  {
    table: "deep_dives",
    column: "self_check_questions",
    ddl: "ALTER TABLE deep_dives ADD COLUMN self_check_questions TEXT NOT NULL DEFAULT '[]';",
  },
  {
    table: "covered_topics",
    column: "deep_dive_id",
    ddl: "ALTER TABLE covered_topics ADD COLUMN deep_dive_id INTEGER REFERENCES deep_dives(id);",
  },
  {
    table: "covered_topics",
    column: "next_review_date",
    ddl: "ALTER TABLE covered_topics ADD COLUMN next_review_date TEXT;",
  },
  {
    table: "covered_topics",
    column: "review_count",
    ddl: "ALTER TABLE covered_topics ADD COLUMN review_count INTEGER NOT NULL DEFAULT 0;",
  },
  // --- Phase 5: Drills ---
  {
    table: "applied_insights",
    column: "drill_id",
    ddl: "ALTER TABLE applied_insights ADD COLUMN drill_id INTEGER REFERENCES drills(id);",
  },
];

/**
 * The ALTER TABLE ADD COLUMN above defaults every existing interest's
 * generates_applied_insights to false. Immediately after adding it for the
 * first time, backfill the per-interest defaults from INTERESTS_SEED (e.g.
 * Psychology/Business/Economics/Philosophy default on) — but only on that
 * first run, so it never clobbers a value the user has since changed in
 * Settings on a later boot.
 */
async function backfillAppliedInsightsDefaults() {
  for (const seed of INTERESTS_SEED) {
    await client.execute({
      sql: "UPDATE interests SET generates_applied_insights = ? WHERE slug = ?",
      args: [seed.generatesAppliedInsights ? 1 : 0, seed.slug],
    });
  }
}

/**
 * Phase 1 created `items.category` as NOT NULL. Phase 2 needs it nullable
 * (only neuroscience items get a category; every other interest leaves it
 * null). SQLite can't relax a NOT NULL constraint via ALTER TABLE, so this
 * rebuilds the table in place if — and only if — the existing column is
 * still NOT NULL. Safe to re-run: a no-op once the column is nullable.
 */
async function rebuildItemsTableIfNeeded() {
  const info = await client.execute("PRAGMA table_info(items)");
  const categoryCol = info.rows.find((r: any) => r.name === "category") as
    | { notnull: number }
    | undefined;
  const hasInterestCol = info.rows.some((r: any) => r.name === "interest_id");
  if (!categoryCol || (categoryCol.notnull === 0 && hasInterestCol)) return; // already migrated or fresh table

  await client.execute("ALTER TABLE items RENAME TO items_old_phase1;");
  await client.execute(`CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    authors TEXT,
    summary TEXT NOT NULL,
    raw_snippet TEXT,
    source_name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    category TEXT,
    interest_id INTEGER REFERENCES interests(id),
    url TEXT NOT NULL,
    dedupe_key TEXT NOT NULL,
    published_at TEXT,
    fetched_at TEXT NOT NULL DEFAULT (current_timestamp),
    score REAL NOT NULL DEFAULT 0,
    digest_id INTEGER REFERENCES digests(id)
  );`);
  await client.execute(`INSERT INTO items
    (id, title, authors, summary, raw_snippet, source_name, source_type, category, url, dedupe_key, published_at, fetched_at, score, digest_id)
    SELECT id, title, authors, summary, raw_snippet, source_name, source_type, category, url, dedupe_key, published_at, fetched_at, score, digest_id
    FROM items_old_phase1;`);
  await client.execute("DROP TABLE items_old_phase1;");
  console.log("[migrate] Rebuilt items table for Phase 2 (category is now nullable, interest_id added).");
}

export async function runMigrations() {
  // `next build` prerenders several pages (including the auto-generated
  // /_not-found) in parallel worker processes, each opening its own
  // connection to the local SQLite file and independently calling
  // ensureDb() -> runMigrations() at roughly the same time. Without this,
  // one worker's write lock makes every other worker fail immediately with
  // SQLITE_BUSY instead of just waiting a moment — busy_timeout makes
  // SQLite retry internally instead.
  //
  // Local file mode ONLY: a hosted Turso database is reached over its
  // Hrana remote protocol, which enforces a restricted SQL subset and
  // rejects PRAGMA busy_timeout outright ("SQL_PARSE_ERROR: SQL not
  // allowed statement") — sending it broke every Vercel deploy. Turso
  // itself already handles concurrent writes, so it doesn't need this.
  if (!usingHostedDb) {
    await client.execute("PRAGMA busy_timeout = 5000;");
  }
  for (const stmt of STATEMENTS) {
    await client.execute(stmt);
  }
  for (const { table, column, ddl } of ADDITIVE_COLUMNS) {
    const result = await client.execute(`PRAGMA table_info(${table})`);
    const hasColumn = result.rows.some((row: any) => row.name === column);
    if (hasColumn) continue;

    let addedByThisProcess = true;
    try {
      await client.execute(ddl);
    } catch (err) {
      // Against a hosted Turso database, multiple processes can run this
      // check-then-add sequence concurrently — e.g. Next.js's parallel
      // build workers, or two serverless cold starts racing right after a
      // fresh deploy. Unlike a local SQLite file (which serializes writers
      // via a file lock), Turso allows both to reach the ALTER TABLE at
      // once, so the check above can pass for both before either commits.
      // A "duplicate column" error at this point unambiguously means
      // another process already added it — exactly the state this call
      // wanted, so treat it as success rather than a failure (but don't
      // run the backfill below twice — see addedByThisProcess).
      const message = err instanceof Error ? err.message : String(err);
      if (!/duplicate column name/i.test(message)) throw err;
      addedByThisProcess = false;
    }

    if (addedByThisProcess && table === "interests" && column === "generates_applied_insights") {
      await backfillAppliedInsightsDefaults();
    }
  }
  await rebuildItemsTableIfNeeded();
  // Re-create indexes in case the rebuild just dropped them along with the table.
  await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS items_dedupe_key_idx ON items(dedupe_key);`);
  await client.execute(`CREATE INDEX IF NOT EXISTS items_digest_id_idx ON items(digest_id);`);
  await client.execute(`CREATE INDEX IF NOT EXISTS items_interest_id_idx ON items(interest_id);`);
  // Depends on covered_topics.next_review_date, which is only guaranteed to
  // exist after the ADDITIVE_COLUMNS loop above has run.
  await client.execute(
    `CREATE INDEX IF NOT EXISTS covered_topics_next_review_idx ON covered_topics(next_review_date);`
  );
}

// Allow `npm run db:migrate` (tsx src/db/migrate.ts) to run this directly.
const isMain = process.argv[1]?.endsWith("migrate.ts");
if (isMain) {
  runMigrations()
    .then(() => console.log("Migrations applied."))
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}

// Applies the schema directly via raw SQL (idempotent CREATE TABLE IF NOT
// EXISTS statements) rather than depending on drizzle-kit's generated
// migration journal. This keeps `npm run db:migrate` self-contained and safe
// to re-run on every startup.
import { client } from "./index";

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
  `CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    authors TEXT,
    summary TEXT NOT NULL,
    raw_snippet TEXT,
    source_name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    category TEXT NOT NULL,
    url TEXT NOT NULL,
    dedupe_key TEXT NOT NULL,
    published_at TEXT,
    fetched_at TEXT NOT NULL DEFAULT (current_timestamp),
    score REAL NOT NULL DEFAULT 0,
    digest_id INTEGER REFERENCES digests(id)
  );`,
  `CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    frequency TEXT NOT NULL DEFAULT 'daily',
    muted_categories TEXT NOT NULL DEFAULT '[]',
    last_refresh_at TEXT,
    last_fact_gen_at TEXT
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS items_dedupe_key_idx ON items(dedupe_key);`,
  `CREATE INDEX IF NOT EXISTS items_digest_id_idx ON items(digest_id);`,
  `CREATE INDEX IF NOT EXISTS brain_facts_last_shown_idx ON brain_facts(last_shown_at);`,
  `INSERT OR IGNORE INTO settings (id, frequency, muted_categories) VALUES (1, 'daily', '[]');`,
];

// Columns added after the initial release — applied via ALTER TABLE, guarded
// so re-running against a DB that already has them is a harmless no-op.
const ADDITIVE_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: "settings", column: "last_fact_gen_at", ddl: "ALTER TABLE settings ADD COLUMN last_fact_gen_at TEXT;" },
];

export async function runMigrations() {
  for (const stmt of STATEMENTS) {
    await client.execute(stmt);
  }
  for (const { table, column, ddl } of ADDITIVE_COLUMNS) {
    const result = await client.execute(`PRAGMA table_info(${table})`);
    const hasColumn = result.rows.some((row: any) => row.name === column);
    if (!hasColumn) {
      await client.execute(ddl);
    }
  }
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

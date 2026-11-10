// Phase 12+ schema: accounts, the shared card pool, feed state and learning
// state. Purely additive — new tables and new nullable/defaulted columns —
// so it is safe to run against a database that still holds pre-launch,
// single-user data. Nothing here deletes or rewrites existing rows.
import type { Client } from "@libsql/client";

const TABLES = [
  `CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    plan TEXT NOT NULL DEFAULT 'free',
    role TEXT NOT NULL DEFAULT 'user',
    prefs TEXT NOT NULL DEFAULT '{}',
    onboarded_at TEXT,
    last_active_at TEXT,
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  );`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  );`,
  `CREATE TABLE IF NOT EXISTS auth_attempts (
    key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  );`,
  `CREATE TABLE IF NOT EXISTS user_interest_prefs (
    user_id INTEGER NOT NULL,
    interest_id INTEGER NOT NULL REFERENCES interests(id),
    level TEXT NOT NULL DEFAULT 'some_background',
    enabled INTEGER NOT NULL DEFAULT 1,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, interest_id)
  );`,
  `CREATE TABLE IF NOT EXISTS concepts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    interest_id INTEGER NOT NULL REFERENCES interests(id),
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    definition TEXT NOT NULL,
    difficulty INTEGER NOT NULL DEFAULT 2,
    deep_dive_id INTEGER,
    chapter_id INTEGER,
    owner_user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  );`,
  `CREATE TABLE IF NOT EXISTS concept_edges (
    from_concept_id INTEGER NOT NULL,
    to_concept_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'prereq',
    PRIMARY KEY (from_concept_id, to_concept_id)
  );`,
  `CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    interest_id INTEGER,
    level TEXT,
    concept_id INTEGER,
    deep_dive_id INTEGER,
    item_id INTEGER,
    seq INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'published',
    dedupe_key TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  );`,
  `CREATE TABLE IF NOT EXISTS user_cards (
    user_id INTEGER NOT NULL,
    card_id INTEGER NOT NULL,
    interest_id INTEGER,
    card_type TEXT NOT NULL,
    seen_at TEXT NOT NULL,
    dwell_ms INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    expanded INTEGER NOT NULL DEFAULT 0,
    saved INTEGER NOT NULL DEFAULT 0,
    shared INTEGER NOT NULL DEFAULT 0,
    skipped_fast INTEGER NOT NULL DEFAULT 0,
    answered_correct INTEGER,
    PRIMARY KEY (user_id, card_id)
  );`,
  `CREATE TABLE IF NOT EXISTS user_concepts (
    user_id INTEGER NOT NULL,
    concept_id INTEGER NOT NULL,
    first_seen_at TEXT NOT NULL,
    due TEXT,
    stability REAL NOT NULL DEFAULT 0,
    difficulty REAL NOT NULL DEFAULT 0,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    state INTEGER NOT NULL DEFAULT 0,
    last_review TEXT,
    scheduled_days INTEGER NOT NULL DEFAULT 0,
    learning_steps INTEGER NOT NULL DEFAULT 0,
    correct_count INTEGER NOT NULL DEFAULT 0,
    wrong_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, concept_id)
  );`,
  `CREATE TABLE IF NOT EXISTS ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    purpose TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  );`,
  `CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'queued',
    dedupe_key TEXT,
    user_id INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    run_after TEXT,
    locked_at TEXT,
    error TEXT,
    result TEXT,
    created_at TEXT NOT NULL DEFAULT (current_timestamp),
    finished_at TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    card_id INTEGER,
    deep_dive_id INTEGER,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  );`,
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    keys TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  );`,
  `CREATE TABLE IF NOT EXISTS error_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  );`,
];

const COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: "interests", column: "created_by_user_id", ddl: "ALTER TABLE interests ADD COLUMN created_by_user_id INTEGER;" },
  { table: "deep_dives", column: "seq", ddl: "ALTER TABLE deep_dives ADD COLUMN seq INTEGER;" },
  { table: "deep_dives", column: "origin", ddl: "ALTER TABLE deep_dives ADD COLUMN origin TEXT NOT NULL DEFAULT 'syllabus';" },
  { table: "deep_dives", column: "status", ddl: "ALTER TABLE deep_dives ADD COLUMN status TEXT NOT NULL DEFAULT 'published';" },
  { table: "deep_dives", column: "quality_score", ddl: "ALTER TABLE deep_dives ADD COLUMN quality_score REAL;" },
  { table: "deep_dives", column: "quality_notes", ddl: "ALTER TABLE deep_dives ADD COLUMN quality_notes TEXT;" },
  { table: "deep_dives", column: "expanded_at", ddl: "ALTER TABLE deep_dives ADD COLUMN expanded_at TEXT;" },
  { table: "explain_backs", column: "user_id", ddl: "ALTER TABLE explain_backs ADD COLUMN user_id INTEGER;" },
  { table: "explain_backs", column: "rating", ddl: "ALTER TABLE explain_backs ADD COLUMN rating TEXT;" },
  { table: "books", column: "user_id", ddl: "ALTER TABLE books ADD COLUMN user_id INTEGER;" },
  { table: "book_chapters", column: "surfaced_at", ddl: "ALTER TABLE book_chapters ADD COLUMN surfaced_at TEXT;" },
];

// Every per-user lookup and every pool query the feed runs is covered here.
const INDEXES = [
  `CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);`,
  `CREATE INDEX IF NOT EXISTS auth_attempts_key_idx ON auth_attempts(key, created_at);`,
  `CREATE INDEX IF NOT EXISTS uip_interest_idx ON user_interest_prefs(interest_id, level);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS concepts_interest_slug_idx ON concepts(interest_id, slug, IFNULL(owner_user_id, 0));`,
  `CREATE INDEX IF NOT EXISTS concepts_dive_idx ON concepts(deep_dive_id);`,
  `CREATE INDEX IF NOT EXISTS concept_edges_to_idx ON concept_edges(to_concept_id);`,
  `CREATE INDEX IF NOT EXISTS cards_pool_idx ON cards(interest_id, level, status);`,
  `CREATE INDEX IF NOT EXISTS cards_dive_idx ON cards(deep_dive_id, seq);`,
  `CREATE INDEX IF NOT EXISTS cards_type_idx ON cards(type, created_at);`,
  `CREATE INDEX IF NOT EXISTS cards_concept_idx ON cards(concept_id);`,
  `CREATE INDEX IF NOT EXISTS user_cards_seen_idx ON user_cards(user_id, seen_at);`,
  `CREATE INDEX IF NOT EXISTS user_cards_saved_idx ON user_cards(user_id, saved);`,
  `CREATE INDEX IF NOT EXISTS user_concepts_due_idx ON user_concepts(user_id, due);`,
  `CREATE INDEX IF NOT EXISTS ai_usage_user_idx ON ai_usage(user_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON ai_usage(created_at);`,
  `CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status, run_after);`,
  `CREATE INDEX IF NOT EXISTS jobs_dedupe_idx ON jobs(dedupe_key, status);`,
  `CREATE INDEX IF NOT EXISTS deep_dives_series_idx ON deep_dives(interest_id, level, seq);`,
  `CREATE INDEX IF NOT EXISTS explain_backs_user_idx ON explain_backs(user_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS books_user_idx ON books(user_id);`,
  `CREATE INDEX IF NOT EXISTS reports_status_idx ON reports(status, created_at);`,
  `CREATE INDEX IF NOT EXISTS items_fetched_idx ON items(interest_id, fetched_at);`,
];

const SEARCH_TABLE = `CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  title,
  body,
  content_type UNINDEXED,
  source_id UNINDEXED,
  interest_label UNINDEXED,
  interest_id UNINDEXED,
  date UNINDEXED,
  url UNINDEXED,
  dedupe_key UNINDEXED,
  user_id UNINDEXED
);`;

export async function getMeta(client: Client, key: string): Promise<string | null> {
  const res = await client.execute({ sql: "SELECT value FROM schema_meta WHERE key = ?", args: [key] });
  return (res.rows[0] as any)?.value ?? null;
}

export async function setMeta(client: Client, key: string, value: string): Promise<void> {
  await client.execute({
    sql: "INSERT INTO schema_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [key, value],
  });
}

export async function runV2Migrations(client: Client): Promise<void> {
  for (const stmt of TABLES) await client.execute(stmt);

  for (const { table, column, ddl } of COLUMNS) {
    const info = await client.execute(`PRAGMA table_info(${table})`);
    if (info.rows.some((r: any) => r.name === column)) continue;
    try {
      await client.execute(ddl);
    } catch (err) {
      // Two processes racing the same ALTER (parallel build workers, two
      // cold starts): the loser sees "duplicate column", which is success.
      const message = err instanceof Error ? err.message : String(err);
      if (!/duplicate column name/i.test(message)) throw err;
    }
  }

  // The search index gained a user_id column so private content (Library
  // chapters, explain-it-back) only matches for its owner. FTS5 tables
  // can't be altered, and the index is fully derivable, so it is dropped
  // and rebuilt by reindexSearch() (lib/searchIndex.ts) on next boot.
  const searchInfo = await client.execute("PRAGMA table_info(search_index)");
  if (!searchInfo.rows.some((r: any) => r.name === "user_id")) {
    await client.execute("DROP TABLE IF EXISTS search_index;");
    await client.execute(SEARCH_TABLE);
    await setMeta(client, "search_reindex_needed", "1");
  }

  for (const stmt of INDEXES) await client.execute(stmt);

  // Seed descriptions used to carry internal notes; tidy rows seeded before launch.
  await client.execute(`UPDATE interests SET description = trim(replace(replace(description, 'The original Phase 1 pipeline.', ''), 'News is a generated roundup.', '')) WHERE is_custom = 0 AND description IS NOT NULL;`);

  // Give pre-launch deep dives a position in their (interest, level) series.
  await client.execute(`
    UPDATE deep_dives SET seq = (
      SELECT COUNT(*) FROM deep_dives d2
      WHERE d2.interest_id = deep_dives.interest_id AND d2.level = deep_dives.level
        AND (d2.created_at < deep_dives.created_at OR (d2.created_at = deep_dives.created_at AND d2.id <= deep_dives.id))
    ) WHERE seq IS NULL;`);
}

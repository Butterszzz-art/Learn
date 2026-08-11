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
  // Phase 6 — explain-it-back, mental models, rabbit hole, brain games.
  // deep_dive_id is nullable here (Phase 7) — see
  // rebuildExplainBacksTableIfNeeded() below for the migration path from
  // Phase 6's NOT NULL version, once a chapter can be the source instead.
  `CREATE TABLE IF NOT EXISTS explain_backs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deep_dive_id INTEGER REFERENCES deep_dives(id),
    user_explanation TEXT NOT NULL,
    feedback TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  );`,
  `CREATE TABLE IF NOT EXISTS mental_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS model_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id INTEGER NOT NULL REFERENCES mental_models(id),
    digest_id INTEGER REFERENCES digests(id),
    date_used TEXT NOT NULL DEFAULT (current_timestamp),
    linked_item_ids TEXT NOT NULL DEFAULT '[]',
    lens_text TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS rabbit_holes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    url TEXT NOT NULL,
    source_name TEXT NOT NULL,
    topic_area TEXT NOT NULL,
    digest_id INTEGER REFERENCES digests(id),
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  );`,
  `CREATE TABLE IF NOT EXISTS brain_games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_type TEXT NOT NULL,
    content TEXT NOT NULL,
    answer TEXT NOT NULL,
    last_shown_at TEXT
  );`,
  // Phase 7 — Library: upload a book, get a drip-fed chapter notebook.
  `CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT,
    original_filename TEXT NOT NULL,
    total_chapters INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'processing',
    error_message TEXT,
    pace_chapters_per_cycle INTEGER NOT NULL DEFAULT 1,
    pace_weeks_requested INTEGER,
    file_base64 TEXT NOT NULL,
    upload_date TEXT NOT NULL DEFAULT (current_timestamp)
  );`,
  `CREATE TABLE IF NOT EXISTS book_chapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL REFERENCES books(id),
    chapter_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    start_page INTEGER,
    end_page INTEGER,
    summary TEXT,
    key_concepts TEXT NOT NULL DEFAULT '[]',
    notable_arguments TEXT NOT NULL DEFAULT '[]',
    quotes TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    digest_id INTEGER REFERENCES digests(id)
  );`,
  `CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    frequency TEXT NOT NULL DEFAULT 'daily',
    muted_categories TEXT NOT NULL DEFAULT '[]',
    last_refresh_at TEXT,
    last_fact_gen_at TEXT
  );`,
  // Phase 11 — unified full-text search. One FTS5 virtual table spanning
  // every content type, rather than per-table search (News, Deep Dives,
  // Applied Insights, Drills, Explain-Backs, Mental Model lenses, Rabbit
  // Holes, Library chapters). `title`/`body` are the only indexed (searched)
  // columns; everything else is UNINDEXED metadata carried along for
  // display/linking. `dedupe_key` (content_type:source_id) is how callers
  // upsert — FTS5's own rowid can't safely be shared across many source
  // tables with overlapping ids, so this app manages its own dedupe instead
  // — see src/lib/searchIndex.ts.
  `CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    title,
    body,
    content_type UNINDEXED,
    source_id UNINDEXED,
    interest_label UNINDEXED,
    interest_id UNINDEXED,
    date UNINDEXED,
    url UNINDEXED,
    dedupe_key UNINDEXED
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
  // Note: explain_backs' indexes are created after rebuildExplainBacksTableIfNeeded()
  // runs below, not here — same reasoning as items' indexes above, and for
  // the same table-rebuild-race reason, protected there too.
  `CREATE INDEX IF NOT EXISTS model_usage_model_idx ON model_usage(model_id);`,
  `CREATE INDEX IF NOT EXISTS model_usage_digest_idx ON model_usage(digest_id);`,
  `CREATE INDEX IF NOT EXISTS rabbit_holes_digest_idx ON rabbit_holes(digest_id);`,
  `CREATE INDEX IF NOT EXISTS brain_games_last_shown_idx ON brain_games(last_shown_at);`,
  `CREATE INDEX IF NOT EXISTS book_chapters_book_idx ON book_chapters(book_id);`,
  `CREATE INDEX IF NOT EXISTS book_chapters_status_idx ON book_chapters(status);`,
  `CREATE INDEX IF NOT EXISTS book_chapters_digest_idx ON book_chapters(digest_id);`,
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
  // --- Phase 6: explain-it-back, mental models, steelman, brain games ---
  {
    table: "deep_dives",
    column: "essay_prompt",
    ddl: "ALTER TABLE deep_dives ADD COLUMN essay_prompt TEXT;",
  },
  {
    table: "items",
    column: "steelman_content",
    ddl: "ALTER TABLE items ADD COLUMN steelman_content TEXT;",
  },
  {
    table: "settings",
    column: "include_brain_games",
    ddl: "ALTER TABLE settings ADD COLUMN include_brain_games INTEGER NOT NULL DEFAULT 0;",
  },
  // --- Phase 7: Library ---
  {
    table: "interests",
    column: "is_library_book",
    ddl: "ALTER TABLE interests ADD COLUMN is_library_book INTEGER NOT NULL DEFAULT 0;",
  },
  {
    table: "drills",
    column: "source_chapter_id",
    ddl: "ALTER TABLE drills ADD COLUMN source_chapter_id INTEGER REFERENCES book_chapters(id);",
  },
  {
    table: "explain_backs",
    column: "chapter_id",
    ddl: "ALTER TABLE explain_backs ADD COLUMN chapter_id INTEGER REFERENCES book_chapters(id);",
  },
  {
    table: "covered_topics",
    column: "chapter_id",
    ddl: "ALTER TABLE covered_topics ADD COLUMN chapter_id INTEGER REFERENCES book_chapters(id);",
  },
  // --- Phase 11: Search, Export, and More Library Formats ---
  {
    table: "books",
    column: "source_type",
    ddl: "ALTER TABLE books ADD COLUMN source_type TEXT NOT NULL DEFAULT 'pdf';",
  },
  {
    table: "books",
    column: "source_url",
    ddl: "ALTER TABLE books ADD COLUMN source_url TEXT;",
  },
  {
    table: "book_chapters",
    column: "raw_text",
    ddl: "ALTER TABLE book_chapters ADD COLUMN raw_text TEXT;",
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

/**
 * Phase 6 created `explain_backs.deep_dive_id` as NOT NULL. Phase 7 needs it
 * nullable (a book chapter can be the source instead, via the new
 * chapter_id column). Same rebuild-in-place pattern as
 * rebuildItemsTableIfNeeded above, for the same reason (SQLite can't relax
 * NOT NULL via ALTER TABLE). Safe to re-run — a no-op once nullable. Must
 * run after the ADDITIVE_COLUMNS loop has added chapter_id, so there's
 * something to carry over in the copy.
 */
async function rebuildExplainBacksTableIfNeeded() {
  const info = await client.execute("PRAGMA table_info(explain_backs)");
  const deepDiveCol = info.rows.find((r: any) => r.name === "deep_dive_id") as
    | { notnull: number }
    | undefined;
  if (!deepDiveCol || deepDiveCol.notnull === 0) return; // already migrated or fresh table

  // Against a hosted Turso database, multiple build workers (or two
  // serverless cold starts) can reach this "needs rebuild" check at once —
  // the same class of race as the ADDITIVE_COLUMNS/seed-script fixes
  // elsewhere in this file, but sharper here because a table rebuild has a
  // real window where `explain_backs` doesn't exist at all (between the
  // RENAME and the CREATE). If another worker is already mid-rebuild, any
  // statement in that window fails with "no such table: explain_backs" —
  // caught below and treated as "someone else is handling it", not an error.
  try {
    await client.execute("ALTER TABLE explain_backs RENAME TO explain_backs_old_phase6;");
  } catch (err) {
    if (isMissingTableError(err, "explain_backs")) return; // another worker already renamed it away
    throw err;
  }

  await client.execute(`CREATE TABLE explain_backs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deep_dive_id INTEGER REFERENCES deep_dives(id),
    chapter_id INTEGER REFERENCES book_chapters(id),
    user_explanation TEXT NOT NULL,
    feedback TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (current_timestamp)
  );`);
  // chapter_id was added to the old table by the ADDITIVE_COLUMNS loop
  // above (which runs before this), so it's carried over too, just in case.
  await client.execute(`INSERT INTO explain_backs
    (id, deep_dive_id, chapter_id, user_explanation, feedback, created_at)
    SELECT id, deep_dive_id, chapter_id, user_explanation, feedback, created_at
    FROM explain_backs_old_phase6;`);
  await client.execute("DROP TABLE explain_backs_old_phase6;");
  console.log("[migrate] Rebuilt explain_backs table for Phase 7 (deep_dive_id is now nullable, chapter_id added).");
}

/** True if `err` is SQLite/Turso's "no such table: <name>" error for the
 * given table — the signal that another concurrent process already moved
 * or dropped it, not a genuine problem. */
function isMissingTableError(err: unknown, tableName: string): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return new RegExp(`no such table:\\s*${tableName}\\b`, "i").test(message);
}

/** Runs a statement, swallowing only a "no such table: <tableName>" error —
 * see rebuildExplainBacksTableIfNeeded's comment for why that specific
 * error is expected and harmless during a concurrent table rebuild. */
async function execIgnoringMissingTable(sql: string, tableName: string) {
  try {
    await client.execute(sql);
  } catch (err) {
    if (!isMissingTableError(err, tableName)) throw err;
  }
}

/**
 * One-time backfill of every piece of content that existed before Phase 11
 * into the new search_index — ongoing content is indexed incrementally at
 * generation time from here on (see src/lib/searchIndex.ts), but anything
 * already in the DB needs a first pass. Guarded by search_index being
 * completely empty, so this never re-runs (and never fights with) the
 * incremental indexing once it's caught up. URL-building here intentionally
 * mirrors (rather than imports) the per-call-site logic in searchIndex.ts's
 * callers — this runs exactly once per database, ever, so a shared
 * abstraction would add more indirection than it saves.
 */
async function backfillSearchIndex() {
  const countRes = await client.execute("SELECT COUNT(*) as n FROM search_index");
  const alreadyIndexed = Number((countRes.rows[0] as any)?.n ?? 0);
  if (alreadyIndexed > 0) return;

  const rows: {
    title: string;
    body: string;
    contentType: string;
    sourceId: number;
    interestLabel: string;
    interestId: number | null;
    date: string;
    url: string;
  }[] = [];

  const interestNameRes = await client.execute("SELECT id, name FROM interests");
  const interestName = new Map<number, string>(
    interestNameRes.rows.map((r: any) => [r.id as number, r.name as string])
  );
  const bookTitleRes = await client.execute("SELECT id, title FROM books");
  const bookTitle = new Map<number, string>(bookTitleRes.rows.map((r: any) => [r.id as number, r.title as string]));

  const itemRes = await client.execute("SELECT id, title, summary, interest_id, digest_id, fetched_at FROM items");
  for (const r of itemRes.rows as any[]) {
    if (r.interest_id == null) continue;
    rows.push({
      title: r.title,
      body: r.summary ?? "",
      contentType: "news",
      sourceId: r.id,
      interestLabel: interestName.get(r.interest_id) ?? "Unknown",
      interestId: r.interest_id,
      date: r.fetched_at,
      url: r.digest_id ? `/archive/${r.digest_id}?at=news-${r.id}` : "/archive",
    });
  }

  const diveRes = await client.execute("SELECT id, topic, content, interest_id, created_at FROM deep_dives");
  for (const r of diveRes.rows as any[]) {
    rows.push({
      title: r.topic,
      body: r.content ?? "",
      contentType: "deep_dive",
      sourceId: r.id,
      interestLabel: interestName.get(r.interest_id) ?? "Unknown",
      interestId: r.interest_id,
      date: r.created_at,
      url: `/deep-dive/${r.id}`,
    });
  }

  const insightRes = await client.execute(
    `SELECT ai.id, ai.content, ai.interest_id, ai.created_at, ai.deep_dive_id, d.digest_id as drill_digest_id
     FROM applied_insights ai LEFT JOIN drills d ON ai.drill_id = d.id`
  );
  for (const r of insightRes.rows as any[]) {
    rows.push({
      title: `Applied Insight — ${interestName.get(r.interest_id) ?? "Unknown"}`,
      body: r.content ?? "",
      contentType: "applied_insight",
      sourceId: r.id,
      interestLabel: interestName.get(r.interest_id) ?? "Unknown",
      interestId: r.interest_id,
      date: r.created_at,
      url: r.deep_dive_id
        ? `/deep-dive/${r.deep_dive_id}`
        : r.drill_digest_id
          ? `/archive/${r.drill_digest_id}`
          : "/drills",
    });
  }

  const drillRes = await client.execute(
    "SELECT id, concept_label, prompt_content, explanation, interest_id, created_at FROM drills"
  );
  for (const r of drillRes.rows as any[]) {
    rows.push({
      title: `Drill — ${r.concept_label}`,
      body: `${r.prompt_content ?? ""}\n\n${r.explanation ?? ""}`,
      contentType: "drill",
      sourceId: r.id,
      interestLabel: interestName.get(r.interest_id) ?? "Unknown",
      interestId: r.interest_id,
      date: r.created_at,
      url: "/drills",
    });
  }

  const explainRes = await client.execute(
    `SELECT eb.id, eb.user_explanation, eb.feedback, eb.created_at, eb.deep_dive_id, eb.chapter_id,
            d.topic as dive_topic, d.interest_id as dive_interest_id,
            c.title as chapter_title, c.book_id as chapter_book_id
     FROM explain_backs eb
     LEFT JOIN deep_dives d ON eb.deep_dive_id = d.id
     LEFT JOIN book_chapters c ON eb.chapter_id = c.id`
  );
  for (const r of explainRes.rows as any[]) {
    const isChapter = r.chapter_id != null;
    rows.push({
      title: `Explain it back — ${isChapter ? r.chapter_title : r.dive_topic ?? "Untitled"}`,
      body: `${r.user_explanation ?? ""}\n\n${r.feedback ?? ""}`,
      contentType: "explain_back",
      sourceId: r.id,
      interestLabel: isChapter ? `Library: ${bookTitle.get(r.chapter_book_id) ?? "book"}` : interestName.get(r.dive_interest_id) ?? "Unknown",
      interestId: isChapter ? null : r.dive_interest_id ?? null,
      date: r.created_at,
      url: isChapter ? `/library/chapter/${r.chapter_id}` : `/deep-dive/${r.deep_dive_id}`,
    });
  }

  const modelRes = await client.execute(
    `SELECT mu.id, mu.lens_text, mu.digest_id, mu.date_used, m.name as model_name
     FROM model_usage mu JOIN mental_models m ON mu.model_id = m.id`
  );
  for (const r of modelRes.rows as any[]) {
    rows.push({
      title: `Mental Model: ${r.model_name}`,
      body: r.lens_text ?? "",
      contentType: "mental_model",
      sourceId: r.id,
      interestLabel: "Mental Model of the Day",
      interestId: null,
      date: r.date_used,
      url: r.digest_id ? `/archive/${r.digest_id}?at=mentalmodel-${r.id}` : "/archive",
    });
  }

  const rabbitRes = await client.execute("SELECT id, title, summary, topic_area, digest_id, created_at FROM rabbit_holes");
  for (const r of rabbitRes.rows as any[]) {
    rows.push({
      title: r.title,
      body: r.summary ?? "",
      contentType: "rabbit_hole",
      sourceId: r.id,
      interestLabel: r.topic_area ?? "Rabbit Hole",
      interestId: null,
      date: r.created_at,
      url: r.digest_id ? `/archive/${r.digest_id}?at=rabbithole-${r.id}` : "/archive",
    });
  }

  const chapterRes = await client.execute(
    "SELECT id, title, summary, key_concepts, notable_arguments, book_id FROM book_chapters WHERE summary IS NOT NULL"
  );
  for (const r of chapterRes.rows as any[]) {
    let keyConceptsText = "";
    try {
      keyConceptsText = (JSON.parse(r.key_concepts ?? "[]") as { term: string; definition: string }[])
        .map((c) => `${c.term}: ${c.definition}`)
        .join("\n");
    } catch {
      keyConceptsText = "";
    }
    rows.push({
      title: r.title,
      body: `${r.summary ?? ""}\n\n${keyConceptsText}`,
      contentType: "chapter",
      sourceId: r.id,
      interestLabel: `Library: ${bookTitle.get(r.book_id) ?? "book"}`,
      interestId: null,
      date: new Date().toISOString(),
      url: `/library/chapter/${r.id}`,
    });
  }

  for (const row of rows) {
    const dedupeKey = `${row.contentType}:${row.sourceId}`;
    try {
      await client.execute({
        sql: `INSERT INTO search_index (title, body, content_type, source_id, interest_label, interest_id, date, url, dedupe_key)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [row.title, row.body, row.contentType, row.sourceId, row.interestLabel, row.interestId, row.date, row.url, dedupeKey],
      });
    } catch (err) {
      console.error(`[migrate] search_index backfill failed for ${dedupeKey}:`, err);
    }
  }
  if (rows.length > 0) {
    console.log(`[migrate] Backfilled search_index with ${rows.length} existing rows.`);
  }
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
  await rebuildExplainBacksTableIfNeeded();
  // Re-create indexes in case the rebuilds just dropped them along with the
  // tables. Protected against the same concurrent-rebuild race as
  // rebuildExplainBacksTableIfNeeded itself — if another worker is mid-
  // rebuild right now, the table can be momentarily missing; that worker
  // will create these same indexes once it finishes, so it's safe for this
  // one to just skip rather than error.
  await execIgnoringMissingTable(`CREATE UNIQUE INDEX IF NOT EXISTS items_dedupe_key_idx ON items(dedupe_key);`, "items");
  await execIgnoringMissingTable(`CREATE INDEX IF NOT EXISTS items_digest_id_idx ON items(digest_id);`, "items");
  await execIgnoringMissingTable(`CREATE INDEX IF NOT EXISTS items_interest_id_idx ON items(interest_id);`, "items");
  await execIgnoringMissingTable(
    `CREATE INDEX IF NOT EXISTS explain_backs_deep_dive_idx ON explain_backs(deep_dive_id);`,
    "explain_backs"
  );
  await execIgnoringMissingTable(
    `CREATE INDEX IF NOT EXISTS explain_backs_chapter_idx ON explain_backs(chapter_id);`,
    "explain_backs"
  );
  // source_chapter_id only exists on `drills` after the ADDITIVE_COLUMNS
  // loop above has run — same reasoning as covered_topics_next_review_idx.
  await client.execute(`CREATE INDEX IF NOT EXISTS drills_source_chapter_idx ON drills(source_chapter_id);`);
  // Depends on covered_topics.next_review_date, which is only guaranteed to
  // exist after the ADDITIVE_COLUMNS loop above has run.
  await client.execute(
    `CREATE INDEX IF NOT EXISTS covered_topics_next_review_idx ON covered_topics(next_review_date);`
  );

  // mental_models/brain_games were seeded without a UNIQUE constraint, so
  // the same concurrent-seeding race that ERRORS on interests.slug (which
  // IS unique — see seedInterests.ts) instead silently DUPLICATED rows here
  // on a hosted Turso database: multiple build workers each saw an empty
  // "already seeded" check and each inserted the full seed set, with
  // nothing to reject the second insert. Deduping first (keep the
  // lowest-id row per name/content) makes CREATE UNIQUE INDEX safe to run
  // even on a DB that already accumulated duplicates before this fix.
  await client.execute(`DELETE FROM mental_models WHERE id NOT IN (SELECT MIN(id) FROM mental_models GROUP BY name);`);
  await client.execute(`DELETE FROM brain_games WHERE id NOT IN (SELECT MIN(id) FROM brain_games GROUP BY content);`);
  await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS mental_models_name_idx ON mental_models(name);`);
  await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS brain_games_content_idx ON brain_games(content);`);

  await backfillSearchIndex();
  // Same concurrent-build-worker race as mental_models/brain_games above
  // (two workers can both see search_index as empty and both backfill) —
  // FTS5 virtual tables can't take a CREATE UNIQUE INDEX to prevent it
  // outright, so clean up after the fact instead, keeping the lowest rowid
  // per dedupe_key. Cheap at this app's scale; safe to run every time.
  await client.execute(
    `DELETE FROM search_index WHERE rowid NOT IN (SELECT MIN(rowid) FROM search_index GROUP BY dedupe_key);`
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

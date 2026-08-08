import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Categories are a fixed set (see spec). Stored as plain text, validated in
// application code rather than a DB-level enum (sqlite has none).
// ---------------------------------------------------------------------------
export const CATEGORIES = [
  "Computational Neuroscience",
  "Quantum Biology",
  "Behavioral Neuroscience",
  "General Neuroscience & Psychobiology",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const SOURCE_TYPES = ["academic", "journalism"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const LEVELS = ["new_to_this", "some_background", "advanced"] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABELS: Record<Level, string> = {
  new_to_this: "New to this",
  some_background: "Some background",
  advanced: "Advanced / studying it",
};

// ---------------------------------------------------------------------------
// interests — the catalog of subjects the feed can pull from. Seeded once;
// the user can add more later (see seedInterests.ts).
// ---------------------------------------------------------------------------
export const interests = sqliteTable("interests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(), // stable code key, e.g. "neuroscience"
  name: text("name").notNull(),
  description: text("description"),
  hasCuratedSource: integer("has_curated_source", { mode: "boolean" }).notNull().default(false),
});

// ---------------------------------------------------------------------------
// userInterests — which interests are enabled and at what level. One row per
// interest (single-user app, so this doubles as "my interests config").
// ---------------------------------------------------------------------------
export const userInterests = sqliteTable("user_interests", {
  interestId: integer("interest_id")
    .primaryKey()
    .references(() => interests.id),
  level: text("level").$type<Level>().notNull().default("some_background"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
});

// ---------------------------------------------------------------------------
// coveredTopics — the syllabus log: which deep-dive subtopics have already
// been shown per interest, so content progresses instead of repeating.
// ---------------------------------------------------------------------------
export const coveredTopics = sqliteTable("covered_topics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  interestId: integer("interest_id")
    .notNull()
    .references(() => interests.id),
  topic: text("topic").notNull(),
  dateCovered: text("date_covered")
    .notNull()
    .default(sql`(current_timestamp)`),
});

// ---------------------------------------------------------------------------
// deepDives — long-form, level-matched, web-search-grounded explainers.
// ---------------------------------------------------------------------------
export const deepDives = sqliteTable("deep_dives", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  interestId: integer("interest_id")
    .notNull()
    .references(() => interests.id),
  topic: text("topic").notNull(),
  content: text("content").notNull(), // markdown body, sources section stripped out
  sources: text("sources").notNull().default("[]"), // JSON array of {title, url}
  level: text("level").$type<Level>().notNull(),
  digestId: integer("digest_id").references(() => digests.id), // which cycle it belongs to
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

// ---------------------------------------------------------------------------
// items — every fetched article/preprint/paper, deduped, categorized, scored.
// ---------------------------------------------------------------------------
export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  authors: text("authors"), // comma-separated, nullable (journalism items rarely have this)
  summary: text("summary").notNull(), // AI-written 2-3 sentence summary, or fallback snippet
  rawSnippet: text("raw_snippet"), // original RSS/abstract snippet, kept for the keyword fallback
  sourceName: text("source_name").notNull(), // e.g. "PubMed", "arXiv", "Quanta Magazine"
  sourceType: text("source_type").$type<SourceType>().notNull(),
  // Category is a legacy, neuroscience-only sub-tag from Phase 1 (one of the
  // four CATEGORIES below). Every other interest leaves this null — the
  // feed's primary organizing dimension is now `interestId`.
  category: text("category").$type<Category | null>(),
  interestId: integer("interest_id").references(() => interests.id),
  url: text("url").notNull(),
  dedupeKey: text("dedupe_key").notNull(), // normalized URL/DOI or fuzzy title hash
  publishedAt: text("published_at"), // ISO date string, nullable if source omits it
  fetchedAt: text("fetched_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  score: real("score").notNull().default(0),
  digestId: integer("digest_id").references(() => digests.id),
});

// ---------------------------------------------------------------------------
// digests — one row per compiled cycle (day or week, per the frequency
// setting). Despite the Phase 1 name, this now represents a "cycle" that
// items and deep dives across ALL enabled interests attach to — kept as
// `digests` to preserve existing local data rather than a risky rename.
// ---------------------------------------------------------------------------
export const digests = sqliteTable("digests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  periodLabel: text("period_label").notNull(), // e.g. "2026-08-08" or "Week of 2026-08-03"
  frequency: text("frequency").$type<"daily" | "weekly">().notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  brainFactId: integer("brain_fact_id").references(() => brainFacts.id),
});

// ---------------------------------------------------------------------------
// brainFacts — the curated + (optionally) AI-augmented fact bank.
// ---------------------------------------------------------------------------
export const brainFacts = sqliteTable("brain_facts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(),
  topic: text("topic"), // e.g. "sleep", "memory", "plasticity" — free-form tag
  source: text("source").$type<"seed" | "generated">().notNull().default("seed"),
  lastShownAt: text("last_shown_at"), // ISO date string, nullable until first shown
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

// ---------------------------------------------------------------------------
// settings — single-row table (id is always 1) for the whole (single-user) app.
// ---------------------------------------------------------------------------
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  frequency: text("frequency").$type<"daily" | "weekly">().notNull().default("daily"),
  mutedCategories: text("muted_categories").notNull().default("[]"), // JSON string array
  lastRefreshAt: text("last_refresh_at"),
  lastFactGenAt: text("last_fact_gen_at"), // when new candidate brain facts were last generated
});

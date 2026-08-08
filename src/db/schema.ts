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
  category: text("category").$type<Category>().notNull(),
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
// digests — one compiled digest per refresh cycle that produces new content.
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

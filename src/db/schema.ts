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

// "generated" = written by Claude (Field News Roundup), not fetched from a feed.
export const SOURCE_TYPES = ["academic", "journalism", "generated"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const LEVELS = ["new_to_this", "some_background", "advanced", "research_level"] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABELS: Record<Level, string> = {
  new_to_this: "New to this",
  some_background: "Some background",
  advanced: "Advanced / studying it",
  research_level: "Research level",
};

/** One notch more advanced than `level`, capped at research_level. Used by
 * Passion Mode to frame favorited interests' deep dives a bit further along
 * than the interest's own stored setting, without changing that setting. */
export function bumpLevel(level: Level): Level {
  const idx = LEVELS.indexOf(level);
  return LEVELS[Math.min(idx + 1, LEVELS.length - 1)];
}

// ---------------------------------------------------------------------------
// Drills (Phase 5) — critical-thinking/logic practice, a content type
// alongside News / Deep Dive / Applied Insight.
// ---------------------------------------------------------------------------
export const DRILL_TYPES = [
  "spot_fallacy",
  "reconstruct_argument",
  "validity_check",
  "strengthen_weaken",
] as const;
export type DrillType = (typeof DRILL_TYPES)[number];

export const DRILL_TYPE_LABELS: Record<DrillType, string> = {
  spot_fallacy: "Spot the Fallacy",
  reconstruct_argument: "Reconstruct the Argument",
  validity_check: "Validity Check",
  strengthen_weaken: "Strengthen or Weaken?",
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
  // User-typed fields (Phase 3) vs. the Phase 2 seed list. Custom interests
  // always have hasCuratedSource=false — there's no registered fetcher for
  // an arbitrary field, so they get a generated Field News Roundup instead.
  isCustom: integer("is_custom", { mode: "boolean" }).notNull().default(false),
  // Whether to generate a short "apply this to daily life" card after each
  // deep dive. Sensible per-interest default at seed/creation time,
  // overridable later in Settings.
  generatesAppliedInsights: integer("generates_applied_insights", { mode: "boolean" })
    .notNull()
    .default(false),
  // Passion Mode (Phase 4): more deep dives per cycle, framed one notch more
  // advanced, plus the Binge/pick-your-next-topic affordances in the feed.
  isFavorite: integer("is_favorite", { mode: "boolean" }).notNull().default(false),
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
  // The deep dive this topic came from — lets a "Remember this?" resurfaced
  // card show a refresher pulled from the original entry. Nullable so rows
  // written before this column existed don't break.
  deepDiveId: integer("deep_dive_id").references(() => deepDives.id),
  // Spaced resurfacing (Phase 4): simple fixed schedule (3 -> 7 -> 21 -> 60
  // days), not a full SM-2 implementation. Null until the first deep dive on
  // this topic is written, which schedules the first review.
  nextReviewDate: text("next_review_date"),
  reviewCount: integer("review_count").notNull().default(0),
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
  // Curiosity branching (Phase 4): 2-3 natural follow-up subtopics with a
  // one-line teaser each, proposed alongside the main entry. JSON array of
  // {topic, teaser}.
  followUpTopics: text("follow_up_topics").notNull().default("[]"),
  // Retention self-check (Phase 4): 2-3 MCQs testing the entry's core ideas.
  // JSON array of {question, options: string[4], correctIndex, explanation}.
  // Answers are never persisted — this is retrieval practice, not a quiz score.
  selfCheckQuestions: text("self_check_questions").notNull().default("[]"),
});

// ---------------------------------------------------------------------------
// appliedInsights — one short, concrete "apply this to daily life" card per
// deep dive, for interests where that generally makes sense. Skipped
// (no row) when a given day's topic doesn't have a natural application.
// ---------------------------------------------------------------------------
export const appliedInsights = sqliteTable("applied_insights", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  interestId: integer("interest_id")
    .notNull()
    .references(() => interests.id),
  deepDiveId: integer("deep_dive_id").references(() => deepDives.id),
  // Phase 5: an insight can also ground in a Drill instead of a Deep Dive —
  // Critical Thinking & Argumentation's primary content is Drills, so its
  // Applied Insights need a source other than deepDiveId. Exactly one of
  // deepDiveId/drillId is set per row in practice, never both.
  drillId: integer("drill_id").references(() => drills.id),
  content: text("content").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

// ---------------------------------------------------------------------------
// drills — critical-thinking/logic practice items (Phase 5). Grounded in a
// real deep dive whenever possible (sourceDeepDiveId set); a small number
// per cycle are standalone formal-logic drills with no source material.
// Rendered like the self-check UI: pick an option, get immediate feedback,
// nothing about the reader's answer is ever persisted.
// ---------------------------------------------------------------------------
export const drills = sqliteTable("drills", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  interestId: integer("interest_id")
    .notNull()
    .references(() => interests.id),
  sourceDeepDiveId: integer("source_deep_dive_id").references(() => deepDives.id),
  drillType: text("drill_type").$type<DrillType>().notNull(),
  promptContent: text("prompt_content").notNull(), // the argument/scenario/question text shown to the reader
  options: text("options").notNull().default("[]"), // JSON array of strings, exactly 4
  correctOption: integer("correct_option").notNull(), // 0-based index into options
  explanation: text("explanation").notNull(),
  // The fallacy/logic-form/argument-pattern being practiced, e.g. "Hasty
  // generalization" or "Affirming the consequent" — logged to coveredTopics
  // so it resurfaces later via spaced resurfacing instead of repeating.
  conceptLabel: text("concept_label").notNull(),
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

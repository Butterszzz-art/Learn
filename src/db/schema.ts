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
  // Library (Phase 7): a hidden pseudo-interest auto-created per uploaded
  // book ("Library: <title>"), purely so coveredTopics.interestId has a
  // valid row to attach book-chapter concepts to for spaced resurfacing.
  // Never has a userInterests row, never shown in onboarding/Settings'
  // interest picker, never touched by the News/Deep-Dive refresh pipeline
  // — getAllInterests()/getEnabledInterests() filter these out explicitly.
  isLibraryBook: integer("is_library_book", { mode: "boolean" }).notNull().default(false),
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
  // Phase 7: a covered topic can instead come from a Library book chapter's
  // key_concepts — lets "Remember this?" pull a refresher from the chapter
  // summary the same way it does for a deep dive. At most one of
  // deepDiveId/chapterId is set per row.
  chapterId: integer("chapter_id").references(() => bookChapters.id),
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
  // Explain-it-back (Phase 6): normally null, meaning the reading view shows
  // the default "explain this back in your own words" prompt. Occasionally
  // (advanced/research_level interests, ~weekly) set to a real open
  // question drawn from the interest's recent covered topics instead.
  essayPrompt: text("essay_prompt"),
});

// ---------------------------------------------------------------------------
// explainBacks (Phase 6) — retrieval practice via free-form writing, not
// just multiple choice: the reader explains a deep dive back in their own
// words (or answers an essayPrompt), and gets brief supportive feedback —
// never a score or grade.
// ---------------------------------------------------------------------------
export const explainBacks = sqliteTable("explain_backs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Phase 7: an explain-it-back entry can now ground in a book chapter
  // instead of a deep dive — deepDiveId relaxed to nullable (was NOT NULL;
  // see rebuildExplainBacksTableIfNeeded in migrate.ts), chapterId added.
  // Exactly one of the two is set per row, never both.
  deepDiveId: integer("deep_dive_id").references(() => deepDives.id),
  chapterId: integer("chapter_id").references(() => bookChapters.id),
  userExplanation: text("user_explanation").notNull(),
  feedback: text("feedback").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
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
  // Phase 7: a grounded drill can also come from a book chapter's
  // notable_arguments instead of a deep dive. At most one of
  // sourceDeepDiveId/sourceChapterId is set per row.
  sourceChapterId: integer("source_chapter_id").references(() => bookChapters.id),
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
// mentalModels (Phase 6) — a cross-cutting library of ~40 general-purpose
// thinking tools, seeded once (mentalModelsSeed.ts), not tied to any
// interest. modelUsage tracks which have been shown and to which content,
// mirroring coveredTopics' no-repeat logic.
// ---------------------------------------------------------------------------
export const MENTAL_MODEL_CATEGORIES = ["probabilistic", "economic", "systems", "logic", "general"] as const;
export type MentalModelCategory = (typeof MENTAL_MODEL_CATEGORIES)[number];

export const mentalModels = sqliteTable("mental_models", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category").$type<MentalModelCategory>().notNull(),
  description: text("description").notNull(), // the model itself, explained — prompt context for the lens card
});

export const modelUsage = sqliteTable("model_usage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  modelId: integer("model_id")
    .notNull()
    .references(() => mentalModels.id),
  digestId: integer("digest_id").references(() => digests.id), // which cycle this "Mental Model of the Day" belongs to
  dateUsed: text("date_used")
    .notNull()
    .default(sql`(current_timestamp)`),
  // JSON array. Phase 6 shape was plain items.id numbers; Phase 7 widened it
  // to {type: "item" | "chapter", id}[] so a lens can also reference a book
  // chapter — parsing code treats a bare number as {type:"item", id} for
  // backward compatibility with rows written before this change.
  linkedItemIds: text("linked_item_ids").notNull().default("[]"),
  // The generated 2-3 sentence card connecting the model to today's items —
  // not in the original spec's column list, but needed to store what was
  // actually written (linkedItemIds alone is just references, no prose).
  lensText: text("lens_text").notNull(),
});

// ---------------------------------------------------------------------------
// rabbitHoles (Phase 6) — one item per cycle, deliberately OUTSIDE the
// reader's active interests. Its own table (not `items`) since it has no
// interestId, isn't part of any interest's News section, and carries an
// extra topicArea field for the "add this as an interest" action.
// ---------------------------------------------------------------------------
export const rabbitHoles = sqliteTable("rabbit_holes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  url: text("url").notNull(),
  sourceName: text("source_name").notNull(),
  topicArea: text("topic_area").notNull(), // e.g. "Volcanology" — the field this came from, and the suggested interest name
  digestId: integer("digest_id").references(() => digests.id),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

// ---------------------------------------------------------------------------
// brainGames (Phase 6) — opt-in, clearly-separate "for fun" bank. Static/
// randomized, seeded once (brainGamesSeed.ts) rather than generated fresh
// every cycle, to keep API cost down — this is deliberately not another
// subject to master, so it doesn't need topical grounding.
// ---------------------------------------------------------------------------
export const BRAIN_GAME_TYPES = [
  "pattern_completion",
  "working_memory_span",
  "quick_math",
  "mini_logic_puzzle",
] as const;
export type BrainGameType = (typeof BRAIN_GAME_TYPES)[number];

export const brainGames = sqliteTable("brain_games", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gameType: text("game_type").$type<BrainGameType>().notNull(),
  content: text("content").notNull(), // the puzzle/question text shown to the reader
  answer: text("answer").notNull(), // revealed on request — self-checked, nothing persisted
  lastShownAt: text("last_shown_at"), // mirrors brainFacts' rotation pattern
});

// ---------------------------------------------------------------------------
// books / bookChapters (Phase 7) — upload a PDF, get a detailed chapter
// notebook, drip-fed into the daily/weekly rhythm instead of dumped at once.
// ---------------------------------------------------------------------------
export const BOOK_STATUSES = ["processing", "ready", "error"] as const;
export type BookStatus = (typeof BOOK_STATUSES)[number];

export const books = sqliteTable("books", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(), // "Untitled" until the structure pass identifies it
  author: text("author"),
  originalFilename: text("original_filename").notNull(),
  totalChapters: integer("total_chapters").notNull().default(0), // 0 until the structure pass completes
  status: text("status").$type<BookStatus>().notNull().default("processing"),
  errorMessage: text("error_message"), // set when status="error" — e.g. "no extractable text layer"
  paceChaptersPerCycle: integer("pace_chapters_per_cycle").notNull().default(1),
  // The user's raw "finish in about __ weeks" input, kept to (re)compute
  // paceChaptersPerCycle once totalChapters is known post-structure-pass —
  // not itself a spec column, but needed to bridge upload-time input to a
  // value that can only be computed after that later step.
  paceWeeksRequested: integer("pace_weeks_requested"),
  // The PDF itself, base64-encoded, stored in the DB rather than on local
  // disk as literally specified — Vercel's serverless filesystem is
  // ephemeral (same reasoning as src/db/index.ts's local-vs-hosted split),
  // so a file written during one request isn't guaranteed to exist for the
  // next. Cleared (set to "") once processing finishes — Claude has already
  // read everything it needs to by then, and there's no reason to keep
  // holding a multi-MB blob in every row indefinitely.
  fileBase64: text("file_base64").notNull(),
  uploadDate: text("upload_date")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export const CHAPTER_STATUSES = ["pending", "surfaced"] as const;
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];

export const bookChapters = sqliteTable("book_chapters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bookId: integer("book_id")
    .notNull()
    .references(() => books.id),
  chapterNumber: integer("chapter_number").notNull(),
  title: text("title").notNull(),
  // Approximate page range from the structure pass — not itself a spec
  // column, but needed to drive the later per-chapter content pass (and
  // its long-chapter windowing) without re-identifying structure each time.
  startPage: integer("start_page"),
  endPage: integer("end_page"),
  // Null until the per-chapter content pass runs (structure-pass rows start
  // as placeholders — title/number only). Non-null is this app's signal
  // for "content generated", independent of `status` below, which tracks
  // "has it been drip-fed to the reader yet" instead.
  summary: text("summary"),
  keyConcepts: text("key_concepts").notNull().default("[]"), // JSON array of {term, definition}
  notableArguments: text("notable_arguments").notNull().default("[]"), // JSON array of strings — grounds drills
  quotes: text("quotes").notNull().default("[]"), // JSON array of short strings — a handful of words each, never long passages
  status: text("status").$type<ChapterStatus>().notNull().default("pending"),
  digestId: integer("digest_id").references(() => digests.id), // which cycle this chapter was surfaced in, once surfaced
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
  // Steelman companion (Phase 6): the strongest good-faith counterargument
  // to this item's actual thesis, web-search-grounded, in the app's own
  // words. Null for most items — only generated when an item presents a
  // genuine arguable thesis (skipped for purely descriptive/discovery
  // news), and capped to ~1-2 per interest per cycle.
  steelmanContent: text("steelman_content"),
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
  // Brain Games (Phase 6): opt-in, off by default — deliberately not part
  // of the interests system, since it's a "for fun" break, not a subject.
  includeBrainGames: integer("include_brain_games", { mode: "boolean" }).notNull().default(false),
});

// Phase 14 (Cost Optimization) — per-content-type model tiering, kept as an
// editable config map (not hardcoded inline in every generation call) so a
// content type can be moved between tiers later based on actually reviewing
// output quality, not just assumption. `ANTHROPIC_MODEL`/`ANTHROPIC_MODEL_HAIKU`
// env vars override the tier's default model id, in case the deployed alias
// names ever diverge from these.

export type ContentType =
  // Haiku tier — compression, extraction, and short structured writing.
  | "news_summary" // curated-source classify/summarize, and Field News Roundup's write step
  | "applied_insight"
  | "drill_grounded"
  | "drill_standalone"
  | "mental_model_lens"
  | "gather" // the search-and-gather step of any split web-search call
  | "brain_game"
  | "follow_up_topics"
  | "self_check_questions"
  | "candidate_topics"
  | "essay_prompt" // the open QUESTION itself, distinct from feedback on it
  | "rabbit_hole_write"
  | "syllabus_parse" // Phase 15 — structured extraction, not sustained writing
  // Sonnet tier — real judgment / sustained argument quality.
  | "deep_dive_write"
  | "steelman_write"
  | "explain_back_feedback";

export type ModelTier = "haiku" | "sonnet";

const TIER_MODEL: Record<ModelTier, string> = {
  haiku: process.env.ANTHROPIC_MODEL_HAIKU || "claude-haiku-4-5",
  sonnet: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
};

/**
 * The tier map itself — this is the thing to edit when a content type's
 * output quality justifies moving it up (or down) a tier. Defaults follow
 * the Phase 14 spec exactly: Haiku for compression/extraction/light
 * structured tasks and the gather half of any split call, Sonnet for the
 * actual long-form writing and anything needing real argumentative judgment.
 */
export const MODEL_TIER: Record<ContentType, ModelTier> = {
  news_summary: "haiku",
  applied_insight: "haiku",
  drill_grounded: "haiku",
  drill_standalone: "haiku",
  mental_model_lens: "haiku",
  gather: "haiku",
  brain_game: "haiku",
  follow_up_topics: "haiku",
  self_check_questions: "haiku",
  candidate_topics: "haiku",
  essay_prompt: "haiku",
  rabbit_hole_write: "haiku",
  syllabus_parse: "haiku",
  deep_dive_write: "sonnet",
  steelman_write: "sonnet",
  explain_back_feedback: "sonnet",
};

/** The model id to use for a given content type — the one thing every
 * generation call site should reach for instead of a hardcoded model string. */
export function getModel(contentType: ContentType): string {
  return TIER_MODEL[MODEL_TIER[contentType]];
}

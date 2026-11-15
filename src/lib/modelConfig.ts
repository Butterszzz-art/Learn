// Which model tier each kind of generation runs on. The tier → model mapping
// (and its environment overrides) lives in ai.ts; this file only says which
// tier a content type needs.
//
// "haiku" tier: compression, extraction, light structured tasks, and the
// search-and-gather step of any web-search call. "sonnet" tier: sustained
// writing that needs real judgment.
import { modelFor } from "./ai";
import type { ModelTier as AiTier } from "./ai";

export type ContentType =
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
  | "syllabus_parse" // structured extraction, not sustained writing
  | "deep_dive_write"
  | "deep_dive_write_research" // research-level entries get the deepest model
  | "steelman_write"
  | "explain_back_feedback";

export type ModelTier = "haiku" | "sonnet" | "opus";

const TO_AI_TIER: Record<ModelTier, AiTier> = { haiku: "fast", sonnet: "main", opus: "deep" };

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
  deep_dive_write_research: "opus",
  steelman_write: "sonnet",
  explain_back_feedback: "sonnet",
};

export function getModel(contentType: ContentType): string {
  return modelFor(TO_AI_TIER[MODEL_TIER[contentType]]);
}

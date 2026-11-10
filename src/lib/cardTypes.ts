// Client-safe types for feed cards. No server imports here — client
// components import this file directly.
import type { CardType, Level } from "@/db/schema";

export type SourceBadge = "peer-reviewed" | "preprint" | "journalism" | "ai-roundup";

export const SOURCE_BADGE_LABELS: Record<SourceBadge, string> = {
  "peer-reviewed": "Peer-reviewed",
  preprint: "Preprint · not yet peer-reviewed",
  journalism: "Journalism",
  "ai-roundup": "Web-sourced summary",
};

export interface BitePayload {
  kind: "hook" | "idea" | "number" | "why";
  highlight?: string; // the key term or number to call out
  takeaway?: string; // one line, shown bold under the body
}
export interface PaperPayload {
  url: string;
  sourceName: string;
  badge: SourceBadge;
  authors?: string | null;
  publishedAt?: string | null;
  takeaway?: string;
}
export interface QuizPayload {
  options: string[];
  correctIndex: number;
  explanation: string;
  kind: "selfcheck" | "drill";
  drillLabel?: string;
}
export interface DebatePayload {
  claim: string;
  url?: string;
  sourceName?: string;
}
export interface VisualPayload {
  mermaid: string;
  caption: string;
}
export interface MythPayload {
  myth: string;
  fact: string;
}
export interface ModelPayload {
  category: string;
}
export interface GamePayload {
  answer: string;
  gameType: string;
}

/** Kinds that exist only in a person's feed, built on the fly. */
export type SyntheticKind = "review" | "recap" | "chapter" | "brewing" | "caughtup";

export interface FeedCard {
  key: string; // unique within a feed session
  kind: CardType | SyntheticKind;
  cardId: number | null; // null for synthetic cards
  interestId: number | null;
  interestName: string | null;
  level: Level | null;
  title: string;
  body: string;
  payload: Record<string, any>;
  conceptId: number | null;
  conceptName: string | null;
  deepDiveId: number | null;
  deepDiveTopic: string | null;
  explore: boolean; // from outside the reader's chosen interests
  saved: boolean;
  aiGenerated: boolean;
}

export const CARD_KIND_LABELS: Record<FeedCard["kind"], string> = {
  bite: "Bite",
  paper: "Research",
  quiz: "Quick check",
  debate: "The other side",
  insight: "Try this",
  visual: "Diagram",
  myth: "Myth vs fact",
  model: "Mental model",
  fact: "Fact",
  game: "Brain game",
  review: "Remember this?",
  recap: "Recap",
  chapter: "From your library",
  brewing: "On its way",
  caughtup: "All caught up",
};

/** Events the client reports about a card. */
export type CardEventName =
  | "impression"
  | "dwell" // value = milliseconds
  | "completed"
  | "expanded"
  | "saved"
  | "unsaved"
  | "shared"
  | "skipped_fast"
  | "quiz_correct"
  | "quiz_incorrect"
  | "go_deeper";

export interface CardEvent {
  cardId: number;
  event: CardEventName;
  value?: number;
}

export type Mastery = "unseen" | "seen" | "learning" | "recalled" | "mastered";

export const MASTERY_LABELS: Record<Mastery, string> = {
  unseen: "Not yet seen",
  seen: "Seen",
  learning: "Learning",
  recalled: "Recalled",
  mastered: "Mastered",
};

// Client-safe types/constants for search (Phase 11), split out of
// searchIndex.ts specifically so client components (SearchOverlay.tsx) can
// import them without pulling in searchIndex.ts's `@/db` import — which
// drags @libsql/client's Node-only (node:fs/node:path) code into the
// browser bundle and breaks the build. searchIndex.ts re-exports these too,
// so server-side code can still import everything from one place.

export type SearchContentType =
  | "news"
  | "deep_dive"
  | "applied_insight"
  | "drill"
  | "explain_back"
  | "mental_model"
  | "rabbit_hole"
  | "chapter";

export const SEARCH_CONTENT_TYPE_LABELS: Record<SearchContentType, string> = {
  news: "News",
  deep_dive: "Deep Dive",
  applied_insight: "Applied Insight",
  drill: "Drill",
  explain_back: "Explain It Back",
  mental_model: "Mental Model",
  rabbit_hole: "Rabbit Hole",
  chapter: "Library Chapter",
};

export const SEARCH_CONTENT_TYPE_ICONS: Record<SearchContentType, string> = {
  news: "📰",
  deep_dive: "📖",
  applied_insight: "💡",
  drill: "🧩",
  explain_back: "✍️",
  mental_model: "🔎",
  rabbit_hole: "🕳️",
  chapter: "📚",
};

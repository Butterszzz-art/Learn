// Phase 14 — split out from engagement.ts so client components (e.g.
// PruningNotices) can import display labels without pulling in
// engagement.ts's server-only DB access (node:fs/node:path via @/db),
// which broke the client bundle when imported directly from a "use client"
// component.
import type { PrunableContentType } from "@/db/schema";

export const CONTENT_TYPE_LABELS: Record<PrunableContentType, string> = {
  news: "News",
  deep_dive: "Deep Dives",
  applied_insight: "Applied Insights",
  drill: "Drills",
  steelman: "the Steelman companion",
};

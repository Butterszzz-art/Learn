import type { Category, SourceType } from "@/db/schema";

// What every fetcher returns, before dedup/categorization/scoring.
export interface RawItem {
  title: string;
  authors?: string;
  snippet: string; // abstract, RSS description, or similar — never the full article body
  url: string;
  publishedAt?: string; // ISO 8601 date string if known
  sourceName: string;
  sourceType: SourceType;
}

// What a RawItem becomes after processing, ready to persist. Category is a
// legacy, neuroscience-only sub-tag (Phase 1) — every other interest leaves
// it null; the feed's primary organizing dimension is now the interest itself.
export interface ProcessedItem extends RawItem {
  summary: string;
  category: Category | null;
  score: number;
  dedupeKey: string;
}

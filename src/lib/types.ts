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
  // Phase 10: true only for sources whose API already returns a genuine
  // structured abstract (PubMed, arXiv, bioRxiv) — `snippet` is that real
  // abstract, safe to summarize from directly. Everything else (plain RSS
  // feeds, including NBER's, and web-search-grounded Field News Roundup
  // items) has too thin a snippet to build a real abstract-style summary
  // from, so the pipeline fetches the linked article page first instead.
  hasFullAbstract?: boolean;
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

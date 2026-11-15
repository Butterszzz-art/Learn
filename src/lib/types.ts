import type { Category, SourceType } from "@/db/schema";

// Phase 15 (Citation Export) — whatever structured citation metadata a
// source actually provides at fetch time. Every field is optional and
// deliberately never backfilled with a guess: PubMed/arXiv/bioRxiv populate
// this richly (real author lists, journal/venue, year, doi/arxivId); plain
// RSS sources (Quanta, ScienceDaily, etc.) populate only what a feed item
// actually carries — usually just `publisher` (the feed's own source name)
// and `year`. Absence of a field means "not available", not "unknown but
// probably X" — export code must never fabricate a missing one.
export interface CitationMetadata {
  authors?: string[];
  journal?: string; // journal/venue name for an academic source
  publisher?: string; // publication/outlet name for a non-academic source
  year?: string;
  doi?: string;
  arxivId?: string;
}

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
  // Phase 15: structured citation metadata, when the source provides it —
  // see CitationMetadata above. Undefined (not `{}`) means the fetcher
  // didn't attempt to populate it at all; persisted as "{}" either way.
  citationMetadata?: CitationMetadata;
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

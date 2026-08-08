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

// What a RawItem becomes after processing, ready to persist.
export interface ProcessedItem extends RawItem {
  summary: string;
  category: Category;
  score: number;
  dedupeKey: string;
}

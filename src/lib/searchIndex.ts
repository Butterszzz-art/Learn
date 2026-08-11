import { client } from "@/db";
import type { SearchContentType } from "./searchTypes";

// Phase 11 — unified full-text search across every content type this app
// generates. Backed by the search_index FTS5 virtual table (see
// db/migrate.ts). Indexed explicitly at each content-creation call site
// (pipeline.ts, libraryPipeline.ts) rather than via a DB trigger — this
// app's existing pattern is "one function does the write" (see e.g.
// insertItems in pipeline.ts), and FTS5's external-content-table trigger
// setup doesn't fit cleanly here anyway, since rows come from many
// different source tables with overlapping ids.
//
// SearchContentType and its display constants live in searchTypes.ts, not
// here — this module imports `@/db` (server-only, drags in @libsql/client's
// Node-only code), so a client component importing so much as a type from
// here breaks the browser bundle. Re-exported below so server-side code can
// still import everything from one place.
export type { SearchContentType } from "./searchTypes";
export { SEARCH_CONTENT_TYPE_LABELS, SEARCH_CONTENT_TYPE_ICONS } from "./searchTypes";

export interface SearchIndexEntry {
  contentType: SearchContentType;
  sourceId: number;
  title: string;
  body: string;
  // Interest name, or "Library: <book title>" for Library content, or a
  // free-form label for content with no interest (Rabbit Hole, Mental
  // Model) — shown next to the result, and used for the group/filter UI.
  interestLabel: string;
  interestId: number | null;
  date: string; // ISO-ish date string, used as the relevance tiebreaker
  url: string; // in-app link this result opens
}

/**
 * Upserts one row into the search index — delete-then-insert keyed on a
 * stable dedupe_key (`contentType:sourceId`), since FTS5's own rowid can't
 * safely be shared across many different source tables with overlapping
 * ids. Best-effort: logs and continues on failure rather than blocking
 * whatever generation step is calling it — a missed search-index row is
 * never worth failing a deep dive/drill/etc. over.
 */
export async function indexForSearch(entry: SearchIndexEntry): Promise<void> {
  const dedupeKey = `${entry.contentType}:${entry.sourceId}`;
  try {
    await client.execute({ sql: "DELETE FROM search_index WHERE dedupe_key = ?", args: [dedupeKey] });
    await client.execute({
      sql: `INSERT INTO search_index (title, body, content_type, source_id, interest_label, interest_id, date, url, dedupe_key)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        entry.title,
        entry.body,
        entry.contentType,
        entry.sourceId,
        entry.interestLabel,
        entry.interestId,
        entry.date,
        entry.url,
        dedupeKey,
      ],
    });
  } catch (err) {
    console.error(`[searchIndex] Failed to index ${dedupeKey}:`, err);
  }
}

/** Removes one row from the search index — e.g. if its source is ever deleted. */
export async function removeFromSearchIndex(contentType: SearchContentType, sourceId: number): Promise<void> {
  const dedupeKey = `${contentType}:${sourceId}`;
  try {
    await client.execute({ sql: "DELETE FROM search_index WHERE dedupe_key = ?", args: [dedupeKey] });
  } catch (err) {
    console.error(`[searchIndex] Failed to remove ${dedupeKey}:`, err);
  }
}

export interface SearchResult {
  contentType: SearchContentType;
  sourceId: number;
  title: string;
  snippet: string; // FTS5 snippet() — the matched excerpt, with <mark> around hits
  interestLabel: string;
  date: string;
  url: string;
}

/** Escapes one search token for safe use inside an FTS5 MATCH query — quoted
 * phrase syntax neutralizes FTS5's own operator keywords (AND/OR/NOT/etc.)
 * appearing in arbitrary user input, and doubling any embedded quote escapes
 * it per FTS5's quoting rules. */
function ftsToken(token: string): string {
  return `"${token.replace(/"/g, '""')}"`;
}

/**
 * Full-text search across every indexed content type. Tokens are AND-ed
 * together with a trailing prefix wildcard each (so "synap" matches
 * "synaptic" as the reader is still typing), ranked by FTS5's bm25 (via the
 * implicit `rank` column) with recency as the tiebreaker per the spec.
 */
export async function searchIndex(query: string, limit = 50): Promise<SearchResult[]> {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const ftsQuery = tokens.map((tok) => `${ftsToken(tok)}*`).join(" AND ");

  try {
    const res = await client.execute({
      sql: `SELECT title, snippet(search_index, 1, '<mark>', '</mark>', '…', 28) as snip,
                   content_type, source_id, interest_label, date, url
            FROM search_index
            WHERE search_index MATCH ?
            ORDER BY rank, date DESC
            LIMIT ?`,
      args: [ftsQuery, limit],
    });
    return res.rows.map((r: any) => ({
      contentType: r.content_type as SearchContentType,
      sourceId: r.source_id as number,
      title: r.title as string,
      snippet: r.snip as string,
      interestLabel: r.interest_label as string,
      date: r.date as string,
      url: r.url as string,
    }));
  } catch (err) {
    // A malformed FTS5 query (e.g. a lone trailing quote) throws rather than
    // returning no results — treat that the same as "no results" instead of
    // surfacing a 500 for what's just an odd search string.
    console.error("[searchIndex] Query failed:", err);
    return [];
  }
}

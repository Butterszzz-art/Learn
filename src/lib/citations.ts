// ---------------------------------------------------------------------------
// Phase 15 — Citation Export. Turns whatever structured metadata a piece of
// content actually has (items.citationMetadata for News, a book's own
// author/title, a Deep Dive's web-search-found sources) into a normalized
// CitationEntry, then renders that as a BibTeX or RIS entry. Every builder
// here follows the same rule the rest of this app's citation handling
// already follows (see CitationMetadata's doc comment in types.ts): export
// only fields that are actually known, never fabricate a missing author,
// year, journal, or DOI.
// ---------------------------------------------------------------------------
import { db } from "@/db";
import { items, books, deepDives } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import type { CitationMetadata } from "./types";
import { getDailyDigestIdsForCurrentWeek } from "./pipeline";

export type CitationEntryType = "article" | "misc" | "book";

export interface CitationEntry {
  entryType: CitationEntryType;
  title: string;
  authors: string[];
  year: string | null;
  journal: string | null; // journal/venue for "article", publisher for "book"
  doi: string | null;
  arxivId: string | null;
  url: string | null;
  note: string | null;
}

function safeParseCitationMetadata(raw: string | null | undefined): CitationMetadata {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** A News item -> a CitationEntry. `academic`/`journalism`/`generated`
 * sourceType items all get one — the difference is just how much structured
 * metadata is actually available (see CitationMetadata). */
export function itemToCitationEntry(item: {
  title: string;
  authors: string | null;
  url: string;
  sourceName: string;
  sourceType: string;
  publishedAt: string | null;
  citationMetadata: string | null;
}): CitationEntry {
  const meta = safeParseCitationMetadata(item.citationMetadata);
  const authors = meta.authors?.length ? meta.authors : item.authors ? item.authors.split(",").map((a) => a.trim()).filter(Boolean) : [];
  const year = meta.year ?? (item.publishedAt ? String(new Date(item.publishedAt).getUTCFullYear()) : null);
  const isFormalArticle = item.sourceType === "academic" && (meta.doi || meta.arxivId || meta.journal);

  return {
    entryType: isFormalArticle ? "article" : "misc",
    title: item.title,
    authors,
    year: year && !isNaN(Number(year)) ? year : null,
    journal: meta.journal ?? null,
    doi: meta.doi ?? null,
    arxivId: meta.arxivId ?? null,
    url: item.url,
    note: meta.publisher && !meta.journal ? meta.publisher : item.sourceName,
  };
}

/** A Library book -> a CitationEntry, using the book's own author/title
 * metadata — no DOI/journal, since a Library upload has neither. */
export function bookToCitationEntry(book: { title: string; author: string | null }): CitationEntry {
  return {
    entryType: "book",
    title: book.title,
    authors: book.author ? [book.author] : [],
    year: null, // publication year isn't captured at upload time — never guessed from uploadDate
    journal: null,
    doi: null,
    arxivId: null,
    url: null,
    note: null,
  };
}

/** A Deep Dive's own web-search-found sources -> one CitationEntry per
 * source. These only ever have a title + URL (that's all the gather step
 * records — see deepDive.ts) — always "misc"/online entries, never a
 * fabricated journal or year. */
export function deepDiveSourcesToCitationEntries(sources: { title: string; url: string }[]): CitationEntry[] {
  return sources.map((s) => ({
    entryType: "misc",
    title: s.title,
    authors: [],
    year: null,
    journal: null,
    doi: null,
    arxivId: null,
    url: s.url,
    note: null,
  }));
}

// ---------------------------------------------------------------------------
// Cite keys — short, stable, human-scannable identifiers for BibTeX entries.
// ---------------------------------------------------------------------------

function firstAuthorSurname(authors: string[]): string {
  if (authors.length === 0) return "Unknown";
  const first = authors[0].trim();
  // "Surname, Initials" (PubMed/bioRxiv dc:creator convention).
  if (first.includes(",")) return first.split(",")[0].trim().replace(/[^A-Za-z]/g, "") || "Unknown";
  const parts = first.split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1] || "";
  // A bare, un-comma'd "Surname II" (older PubMed rows fetched before this
  // app started reformatting author names — see formatPubMedAuthorName in
  // fetchers/pubmed.ts): the trailing token is a short ALL-CAPS run of
  // initials, never how a real surname's last word looks ("Doe", not "T"
  // or "QS") — so the FIRST token is the surname there, not the last.
  if (parts.length > 1 && /^[A-Z]{1,3}$/.test(last)) {
    return parts[0].replace(/[^A-Za-z]/g, "") || "Unknown";
  }
  return (last || "Unknown").replace(/[^A-Za-z]/g, "") || "Unknown";
}

function firstTitleWord(title: string): string {
  const word = title.trim().split(/\s+/).find((w) => /[A-Za-z]/.test(w));
  return (word ?? "untitled").replace(/[^A-Za-z0-9]/g, "");
}

export function citeKeyFor(entry: CitationEntry, disambiguator?: number): string {
  // No "nd" filler when the year is unknown — "KahnemanThinking" reads
  // better than "KahnemanndThinking", and there's nothing to disambiguate
  // against a fabricated placeholder anyway.
  const base = `${firstAuthorSurname(entry.authors)}${entry.year ?? ""}${firstTitleWord(entry.title)}`;
  return disambiguator ? `${base}${disambiguator}` : base;
}

// ---------------------------------------------------------------------------
// BibTeX
// ---------------------------------------------------------------------------

function bibEscape(value: string): string {
  return value.replace(/[{}]/g, "");
}

function bibField(name: string, value: string | null): string {
  if (!value) return "";
  return `  ${name} = {${bibEscape(value)}},\n`;
}

/** Same as bibField, but for a value that's already valid BibTeX field
 * content (e.g. a `\url{...}` command) — bibField's brace-stripping would
 * otherwise eat the braces the LaTeX command itself needs. */
function bibFieldRaw(name: string, value: string | null): string {
  if (!value) return "";
  return `  ${name} = {${value}},\n`;
}

export function toBibTeX(entry: CitationEntry, key: string): string {
  const bibType = entry.entryType === "article" ? "article" : entry.entryType === "book" ? "book" : "misc";
  let body = "";
  body += bibField("title", entry.title);
  if (entry.authors.length > 0) body += bibField("author", entry.authors.join(" and "));
  body += bibField("year", entry.year);
  body += bibField(entry.entryType === "book" ? "publisher" : "journal", entry.journal);
  body += bibField("doi", entry.doi);
  if (entry.arxivId) body += bibField("eprint", entry.arxivId) + bibField("archiveprefix", "arXiv");
  if (entry.url) {
    body +=
      bibType === "misc" ? bibFieldRaw("howpublished", `\\url{${entry.url}}`) : bibField("url", entry.url);
  }
  if (entry.note) body += bibField("note", entry.note);
  return `@${bibType}{${key},\n${body}}\n`;
}

// ---------------------------------------------------------------------------
// RIS
// ---------------------------------------------------------------------------

function risType(entryType: CitationEntryType): string {
  if (entryType === "article") return "JOUR";
  if (entryType === "book") return "BOOK";
  return "ELEC"; // web/online source with no formal venue
}

export function toRIS(entry: CitationEntry): string {
  const lines: string[] = [`TY  - ${risType(entry.entryType)}`];
  for (const author of entry.authors) lines.push(`AU  - ${author}`);
  lines.push(`TI  - ${entry.title}`);
  if (entry.year) lines.push(`PY  - ${entry.year}`);
  if (entry.journal) lines.push(`${entry.entryType === "book" ? "PB" : "JO"}  - ${entry.journal}`);
  if (entry.doi) lines.push(`DO  - ${entry.doi}`);
  if (entry.arxivId) lines.push(`AN  - arXiv:${entry.arxivId}`);
  if (entry.url) lines.push(`UR  - ${entry.url}`);
  if (entry.note) lines.push(`N1  - ${entry.note}`);
  lines.push("ER  - ");
  return lines.join("\n") + "\n";
}

/** Bulk BibTeX — one .bib file's worth of entries, deduping cite keys with a
 * numeric suffix on collision (two different papers by the same first
 * author, same year, same first title word — rare but possible). */
export function bulkBibTeX(entries: CitationEntry[]): string {
  const usedKeys = new Set<string>();
  const blocks: string[] = [];
  for (const entry of entries) {
    let key = citeKeyFor(entry);
    let suffix = 2;
    while (usedKeys.has(key)) {
      key = citeKeyFor(entry, suffix);
      suffix++;
    }
    usedKeys.add(key);
    blocks.push(toBibTeX(entry, key));
  }
  return blocks.join("\n");
}

export function bulkRIS(entries: CitationEntry[]): string {
  return entries.map((e) => toRIS(e)).join("\n");
}

// ---------------------------------------------------------------------------
// Thin DB-fetch helpers — one per "cite" API route (see src/app/api/cite/*),
// so those routes stay a fetch-and-respond shell rather than duplicating
// query logic. Same pairing pattern as export.ts (query + render together).
// ---------------------------------------------------------------------------

/** One News item -> its CitationEntry, or null if it doesn't exist. */
export async function getItemCitationEntry(id: number): Promise<CitationEntry | null> {
  const rows = await db.select().from(items).where(eq(items.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return itemToCitationEntry(row);
}

/** One Library book -> its CitationEntry, or null if it doesn't exist. */
export async function getBookCitationEntry(id: number): Promise<CitationEntry | null> {
  const rows = await db.select().from(books).where(eq(books.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return bookToCitationEntry(row);
}

/** One Deep Dive's sources -> their CitationEntries plus the dive's topic
 * (for the export filename), or null if the dive doesn't exist. Empty
 * `entries` array if the dive genuinely has no sources (a synthesized entry
 * — see trustSignals.ts) rather than an error. */
export async function getDeepDiveSourceCitations(id: number): Promise<{ topic: string; entries: CitationEntry[] } | null> {
  const rows = await db.select().from(deepDives).where(eq(deepDives.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  let sources: { title: string; url: string }[] = [];
  try {
    sources = JSON.parse(row.sources);
  } catch {
    sources = [];
  }
  return { topic: row.topic, entries: deepDiveSourcesToCitationEntries(sources) };
}

/** Every News item across the current WEEKLY cycle (every daily cycle so
 * far this week, matching how the rest of this app already scopes "this
 * week" — see getDailyDigestIdsForCurrentWeek in pipeline.ts) — the bulk
 * "export this week's sources as BibTeX" action. */
export async function getWeekCitationEntries(): Promise<CitationEntry[]> {
  const dailyIds = await getDailyDigestIdsForCurrentWeek();
  if (dailyIds.length === 0) return [];
  const rows = await db.select().from(items).where(inArray(items.digestId, dailyIds));
  return rows.map((row) => itemToCitationEntry(row));
}

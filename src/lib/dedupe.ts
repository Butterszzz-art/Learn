import type { RawItem } from "./types";

/** Normalizes a URL for comparison: strips protocol, query/hash, trailing slash, www. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    let host = u.hostname.replace(/^www\./, "");
    let path = u.pathname.replace(/\/+$/, "");
    return `${host}${path}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

const COMBINING_DIACRITICS_START = 0x0300;
const COMBINING_DIACRITICS_END = 0x036f;

function stripDiacritics(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= COMBINING_DIACRITICS_START && code <= COMBINING_DIACRITICS_END) continue;
    out += ch;
  }
  return out;
}

/** Cheap fuzzy-title key: lowercase, strip punctuation/whitespace, collapse. */
export function fuzzyTitleKey(title: string): string {
  return stripDiacritics(title.toLowerCase().normalize("NFKD"))
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/** Dedupe key used for DB uniqueness — prefers normalized URL, falls back to title. */
export function dedupeKeyFor(item: RawItem): string {
  return item.url ? normalizeUrl(item.url) : `title:${fuzzyTitleKey(item.title)}`;
}

/**
 * Deduplicates a list of RawItems by normalized URL first, then by fuzzy
 * title match (catches the same story cross-posted under different URLs,
 * e.g. a PubMed entry and its journal-hosted twin).
 */
export function dedupeItems(items: RawItem[]): RawItem[] {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const result: RawItem[] = [];

  for (const item of items) {
    if (!item.title || !item.url) continue;
    const urlKey = normalizeUrl(item.url);
    const titleKey = fuzzyTitleKey(item.title);
    if (seenUrls.has(urlKey) || seenTitles.has(titleKey)) continue;
    seenUrls.add(urlKey);
    seenTitles.add(titleKey);
    result.push(item);
  }
  return result;
}

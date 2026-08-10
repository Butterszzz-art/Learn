import { XMLParser } from "fast-xml-parser";
import type { RawItem } from "../types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
  // See the matching comment in fetchers/rss.ts — raises fast-xml-parser's
  // default entity-expansion ceiling for ordinary public feeds.
  processEntities: { enabled: true, maxTotalExpansions: 50_000 },
});

const ARXIV_API = "http://export.arxiv.org/api/query";

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Runs a raw arXiv search query (e.g. `cat:cs.AI`) and returns normalized
 * RawItems. Exported so other interests' fetchers can reuse the arXiv API
 * without duplicating the fetch/parse plumbing.
 */
export async function queryArxiv(searchQuery: string, maxResults: number): Promise<RawItem[]> {
  const url =
    `${ARXIV_API}?search_query=${encodeURIComponent(searchQuery)}` +
    `&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);
  let xml: string;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Neuron/0.1 (personal local knowledge feed)" },
    });
    if (!res.ok) throw new Error(`arXiv returned HTTP ${res.status}`);
    xml = await res.text();
  } catch (err) {
    console.error(`[arxiv] Fetch failed for query "${searchQuery}":`, err);
    return [];
  } finally {
    clearTimeout(t);
  }

  let parsed: any;
  try {
    parsed = parser.parse(xml);
  } catch (err) {
    console.error("[arxiv] XML parse failed:", err);
    return [];
  }

  const entries = asArray(parsed?.feed?.entry);
  const items: RawItem[] = [];
  for (const entry of entries) {
    const title = String(entry.title ?? "").replace(/\s+/g, " ").trim();
    if (!title) continue;
    const summary = String(entry.summary ?? "").replace(/\s+/g, " ").trim();
    const authors = asArray(entry.author)
      .map((a: any) => (typeof a === "string" ? a : a?.name))
      .filter(Boolean)
      .join(", ");
    let link = "";
    const links = asArray(entry.link);
    const alt = links.find((l: any) => l["@_rel"] === "alternate") ?? links[0];
    link = alt?.["@_href"] ?? "";
    const published = entry.published ? new Date(entry.published).toISOString() : undefined;

    items.push({
      title,
      authors: authors || undefined,
      // Phase 10: raised from 800 — the real abstract's full substance is
      // needed now that News summaries target ~120-200 words, not a
      // truncated fragment of it.
      snippet: summary.slice(0, 3000),
      url: link,
      publishedAt: published,
      sourceName: "arXiv",
      sourceType: "academic",
      // A real structured abstract from arXiv's API — see hasFullAbstract's
      // doc comment in types.ts.
      hasFullAbstract: true,
    });
  }
  return items;
}

/**
 * Fetches recent arXiv q-bio.NC (neurons and cognition) papers, plus a
 * separate quantum-biology/brain crossover query, and merges the results.
 */
export async function fetchArxiv(maxResultsEach = 25): Promise<RawItem[]> {
  const [neuroscience, quantumBio] = await Promise.all([
    queryArxiv("cat:q-bio.NC", maxResultsEach),
    queryArxiv(
      'abs:"quantum biology" AND (abs:brain OR abs:neural OR abs:consciousness OR abs:microtubule)',
      maxResultsEach
    ),
  ]);
  const seen = new Set<string>();
  const merged: RawItem[] = [];
  for (const item of [...neuroscience, ...quantumBio]) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    merged.push(item);
  }
  return merged;
}

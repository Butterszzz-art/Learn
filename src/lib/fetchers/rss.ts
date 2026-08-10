import { XMLParser } from "fast-xml-parser";
import type { RawItem } from "../types";
import type { SourceType } from "@/db/schema";
import { decodeEntities } from "../htmlEntities";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
  // Some feeds (e.g. MIT News' <content:encoded> blocks) contain enough
  // repeated HTML entities to trip fast-xml-parser's default XML-bomb guard
  // (1000 total expansions). These are ordinary public RSS feeds, not
  // untrusted/adversarial input, so raise the ceiling generously.
  processEntities: { enabled: true, maxTotalExpansions: 50_000 },
});

function stripHtml(input: string | undefined | null): string {
  if (!input) return "";
  return decodeEntities(
    input.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text: string, max = 500): string {
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj["#text"] === "string") return obj["#text"];
    if (typeof obj["@_href"] === "string") return obj["@_href"] as string;
  }
  return "";
}

/**
 * Fetches and parses a feed that may be RSS 2.0, RSS 1.0/RDF, or Atom, and
 * normalizes it into RawItem[]. Never returns the full article body — only
 * the feed-provided title/snippet, to respect publisher copyright.
 */
export async function fetchRssFeed(
  url: string,
  sourceName: string,
  sourceType: SourceType = "journalism",
  opts: { timeoutMs?: number; maxItems?: number; snippetMaxChars?: number } = {}
): Promise<RawItem[]> {
  const { timeoutMs = 15000, maxItems = 30, snippetMaxChars = 500 } = opts;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let xml: string;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Neuron/0.1 (personal local knowledge feed)",
        Accept: "application/rss+xml, application/xml, text/xml, application/atom+xml",
      },
    });
    if (!res.ok) {
      throw new Error(`${sourceName} feed returned HTTP ${res.status}`);
    }
    xml = await res.text();
  } catch (err) {
    console.error(`[rss] Failed to fetch ${sourceName} (${url}):`, err);
    return [];
  } finally {
    clearTimeout(timeout);
  }

  let parsed: any;
  try {
    parsed = parser.parse(xml);
  } catch (err) {
    console.error(`[rss] Failed to parse XML for ${sourceName}:`, err);
    return [];
  }

  const items: RawItem[] = [];

  // RSS 2.0: rss.channel.item[]
  const rssItems = asArray(parsed?.rss?.channel?.item);
  // RSS 1.0 / RDF: rdf:RDF.item[]
  const rdfItems = asArray(parsed?.["rdf:RDF"]?.item);
  // Atom: feed.entry[]
  const atomEntries = asArray(parsed?.feed?.entry);

  for (const raw of [...rssItems, ...rdfItems]) {
    const title = stripHtml(textOf(raw.title));
    const link = textOf(raw.link) || textOf(raw.guid);
    const description = stripHtml(
      textOf(raw.description) || textOf(raw["content:encoded"]) || textOf(raw.summary)
    );
    const pubDate = textOf(raw.pubDate) || textOf(raw["dc:date"]) || textOf(raw.date);
    if (!title || !link) continue;
    items.push({
      title,
      snippet: truncate(description, snippetMaxChars),
      url: link,
      publishedAt: normalizeDate(pubDate),
      sourceName,
      sourceType,
    });
  }

  for (const entry of atomEntries) {
    const title = stripHtml(textOf(entry.title));
    let link = "";
    if (Array.isArray(entry.link)) {
      const alt = entry.link.find((l: any) => l["@_rel"] === "alternate") ?? entry.link[0];
      link = alt?.["@_href"] ?? "";
    } else if (entry.link) {
      link = entry.link["@_href"] ?? textOf(entry.link);
    }
    const description = stripHtml(textOf(entry.summary) || textOf(entry.content));
    const pubDate = textOf(entry.published) || textOf(entry.updated);
    if (!title || !link) continue;
    items.push({
      title,
      snippet: truncate(description, snippetMaxChars),
      url: link,
      publishedAt: normalizeDate(pubDate),
      sourceName,
      sourceType,
    });
  }

  return items.slice(0, maxItems);
}

function normalizeDate(input: string): string | undefined {
  if (!input) return undefined;
  const d = new Date(input);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

export { stripHtml, truncate };

import type { RawItem } from "../types";

const PUBMED_QUERY =
  '(neuroscience[Title/Abstract] OR "computational neuroscience"[Title/Abstract] ' +
  'OR "behavioral neuroscience"[Title/Abstract] OR "quantum biology"[Title/Abstract] ' +
  "OR psychobiology[Title/Abstract] OR neuroplasticity[Title/Abstract] " +
  'OR "cognitive neuroscience"[Title/Abstract])';

const ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const ESUMMARY_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";
const EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

async function fetchJson(url: string, timeoutMs = 15000): Promise<any> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Neuron/0.1 (personal local knowledge feed)" },
    });
    if (!res.ok) throw new Error(`PubMed request returned HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Fetches recent PubMed articles matching the neuroscience/psychobiology
 * query, restricted to the last `days` days, and pulls abstracts via efetch
 * (esummary alone doesn't include abstracts).
 */
export async function fetchPubMed(days = 3, retmax = 25): Promise<RawItem[]> {
  try {
    const searchUrl =
      `${ESEARCH_URL}?db=pubmed&retmode=json&sort=date&retmax=${retmax}` +
      `&reldate=${days}&datetype=pdat&term=${encodeURIComponent(PUBMED_QUERY)}`;
    const searchJson = await fetchJson(searchUrl);
    const ids: string[] = searchJson?.esearchresult?.idlist ?? [];
    if (ids.length === 0) return [];

    const summaryUrl = `${ESUMMARY_URL}?db=pubmed&retmode=json&id=${ids.join(",")}`;
    const summaryJson = await fetchJson(summaryUrl);
    const result = summaryJson?.result ?? {};

    // efetch for abstracts (XML) — best effort; if it fails we still return
    // items with an empty snippet, which the categorizer/summarizer handles.
    const abstracts = await fetchAbstracts(ids).catch((err) => {
      console.error("[pubmed] efetch abstracts failed:", err);
      return new Map<string, string>();
    });

    const items: RawItem[] = [];
    for (const id of ids) {
      const doc = result[id];
      if (!doc) continue;
      const title: string = (doc.title ?? "").replace(/\s+/g, " ").trim();
      if (!title) continue;
      const authorList: string[] = Array.isArray(doc.authors)
        ? doc.authors.map((a: any) => a.name).filter(Boolean).map(formatPubMedAuthorName)
        : [];
      const authors = authorList.length > 0 ? authorList.join(", ") : undefined;
      const pubDateRaw: string = doc.pubdate ?? doc.sortpubdate ?? "";
      const publishedAt = normalizePubDate(pubDateRaw);
      // esummary's articleids array carries the DOI when PubMed has one on
      // file (idtype "doi") — see doc comment on CitationMetadata for why
      // this is only populated when actually present, never guessed.
      const doi: string | undefined = Array.isArray(doc.articleids)
        ? doc.articleids.find((a: any) => a?.idtype === "doi")?.value
        : undefined;
      const journal: string | undefined = doc.fulljournalname || doc.source || undefined;
      const year = publishedAt ? String(new Date(publishedAt).getUTCFullYear()) : undefined;

      items.push({
        title,
        authors,
        snippet: abstracts.get(id) ?? "",
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        publishedAt,
        sourceName: "PubMed",
        sourceType: "academic",
        // A real structured abstract from efetch — see hasFullAbstract's
        // doc comment in types.ts.
        hasFullAbstract: true,
        citationMetadata: {
          authors: authorList.length > 0 ? authorList : undefined,
          journal,
          year,
          doi,
        },
      });
    }
    return items;
  } catch (err) {
    console.error("[pubmed] Fetch failed:", err);
    return [];
  }
}

async function fetchAbstracts(ids: string[]): Promise<Map<string, string>> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);
  const map = new Map<string, string>();
  try {
    const url = `${EFETCH_URL}?db=pubmed&retmode=xml&rettype=abstract&id=${ids.join(",")}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return map;
    const xml = await res.text();
    // Lightweight regex extraction — avoids pulling in a second XML parser
    // config just for this; PubMed's efetch XML is well-formed and stable.
    const articleRegex = /<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g;
    const pmidRegex = /<PMID[^>]*>(\d+)<\/PMID>/;
    const abstractRegex = /<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g;
    const articles = xml.match(articleRegex) ?? [];
    for (const article of articles) {
      const pmidMatch = article.match(pmidRegex);
      if (!pmidMatch) continue;
      const pmid = pmidMatch[1];
      let abstractParts: string[] = [];
      let m: RegExpExecArray | null;
      abstractRegex.lastIndex = 0;
      while ((m = abstractRegex.exec(article)) !== null) {
        abstractParts.push(m[1].replace(/<[^>]+>/g, " "));
      }
      const abstract = abstractParts
        .join(" ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
      // Phase 10: raised from 800 — News summaries now write a thorough
      // ~250-320 word abstract-style summary and need the real abstract's
      // full substance, not a truncated fragment of it.
      if (abstract) map.set(pmid, abstract.slice(0, 3000));
    }
  } catch (err) {
    console.error("[pubmed] efetch error:", err);
  } finally {
    clearTimeout(t);
  }
  return map;
}

// PubMed's esummary author names come as "Surname II" (surname, then 1-3
// bare initial letters, no comma, no periods — e.g. "Herdman N", "Padiath
// QS"). Reformatted to the standard "Surname, I. I." citation convention so
// citations.ts's cite-key/BibTeX author handling (which looks for a comma
// to find the surname) works correctly — without this, "Herdman N" reads as
// surname "N" instead of "Herdman".
function formatPubMedAuthorName(name: string): string {
  const trimmed = name.trim();
  const match = trimmed.match(/^(.+?)\s+([A-Z]{1,3})$/);
  if (!match) return trimmed;
  const [, surname, initials] = match;
  return `${surname}, ${initials.split("").join(". ")}.`;
}

function normalizePubDate(raw: string): string | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString();
  // PubMed sometimes returns "2026 Aug" or "2026" — fall back to year-only.
  const yearMatch = raw.match(/\d{4}/);
  if (yearMatch) return new Date(`${yearMatch[0]}-01-01`).toISOString();
  return undefined;
}

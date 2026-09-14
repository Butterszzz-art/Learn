// Research Agent (add-on feature): widens paper discovery beyond the
// curated PubMed/arXiv/bioRxiv fetchers in src/lib/fetchers/ by querying
// OpenAlex and Semantic Scholar directly — both free, no key required
// (Semantic Scholar accepts an optional key for a higher rate limit).
//
// This module does NOT call any LLM — it's a plain HTTP fetcher. The AI
// agent that decides *when* to call it lives in researchAgent.ts.

// OpenAlex asks for a contact email in the "polite pool" for better rate
// limits (not an API key — just an email string). Left unset by default;
// the param is simply omitted rather than sending a placeholder.
const OPENALEX_MAILTO = process.env.OPENALEX_MAILTO || undefined;

// Optional — raises Semantic Scholar's rate limit. Leave unset to use the
// public tier.
const SEMANTIC_SCHOLAR_API_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY;

const OPENALEX_BASE = "https://api.openalex.org/works";
const S2_BASE = "https://api.semanticscholar.org/graph/v1/paper/search";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Both APIs rate-limit anonymous/free traffic aggressively. One retry after
 * a short, jittered backoff (honoring Retry-After if the server sends one)
 * absorbs an occasional 429 instead of failing the whole search outright. */
async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status !== 429) return res;

  const retryAfterHeader = res.headers.get("retry-after");
  const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
  const delay = Number.isFinite(retryAfterMs) ? retryAfterMs : 1000 + Math.random() * 500;
  await sleep(delay);

  return fetch(url, init);
}

export type ExternalSource = "openalex" | "semantic_scholar";

export interface CandidatePaper {
  externalId: string; // e.g. "openalex:W2741809807" or "semantic_scholar:abcd1234"
  source: ExternalSource;
  title: string;
  abstract: string | null;
  authors: string[];
  doi: string | null;
  url: string | null;
  openAccessPdfUrl: string | null;
  publishedDate: string | null; // ISO 8601 date, if known
  venue: string | null;
  citationCount: number | null;
  fieldsOfStudy: string[];
}

export interface FetchOptions {
  /** Free-text query, e.g. "computational neuroscience" */
  query: string;
  /** Only return works published on/after this ISO date, e.g. "2026-08-01" */
  fromDate?: string;
  /** Max results per source per query, default 10 */
  perSourceLimit?: number;
}

// ---------- OpenAlex ----------

async function fetchFromOpenAlex(opts: FetchOptions): Promise<CandidatePaper[]> {
  const { query, fromDate, perSourceLimit = 10 } = opts;

  const params = new URLSearchParams({
    search: query,
    per_page: String(perSourceLimit),
  });
  if (OPENALEX_MAILTO) params.set("mailto", OPENALEX_MAILTO);
  if (fromDate) params.set("filter", `from_publication_date:${fromDate}`);

  const res = await fetchWithRetry(`${OPENALEX_BASE}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`OpenAlex request failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  return (json.results ?? []).map((work: any): CandidatePaper => {
    const abstract = reconstructOpenAlexAbstract(work.abstract_inverted_index);

    return {
      externalId: `openalex:${work.id?.replace("https://openalex.org/", "")}`,
      source: "openalex",
      title: work.title ?? "Untitled",
      abstract,
      authors: (work.authorships ?? []).map((a: any) => a?.author?.display_name ?? "Unknown"),
      doi: work.doi ? work.doi.replace("https://doi.org/", "") : null,
      url: work.primary_location?.landing_page_url ?? work.id ?? null,
      openAccessPdfUrl: work.open_access?.oa_url ?? null,
      publishedDate: work.publication_date ?? null,
      venue: work.primary_location?.source?.display_name ?? null,
      citationCount: work.cited_by_count ?? null,
      fieldsOfStudy: (work.concepts ?? []).slice(0, 5).map((c: any) => c.display_name),
    };
  });
}

function reconstructOpenAlexAbstract(
  invertedIndex: Record<string, number[]> | undefined
): string | null {
  if (!invertedIndex) return null;

  const positioned: string[] = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      positioned[pos] = word;
    }
  }
  const text = positioned.join(" ").trim();
  return text.length > 0 ? text : null;
}

// ---------- Semantic Scholar ----------

async function fetchFromSemanticScholar(opts: FetchOptions): Promise<CandidatePaper[]> {
  const { query, perSourceLimit = 10 } = opts;

  const params = new URLSearchParams({
    query,
    limit: String(perSourceLimit),
    fields:
      "title,abstract,authors,externalIds,openAccessPdf,publicationDate,venue,citationCount,fieldsOfStudy,url",
  });

  const headers: Record<string, string> = {};
  if (SEMANTIC_SCHOLAR_API_KEY) headers["x-api-key"] = SEMANTIC_SCHOLAR_API_KEY;

  const res = await fetchWithRetry(`${S2_BASE}?${params.toString()}`, { headers });
  if (!res.ok) {
    throw new Error(`Semantic Scholar request failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  return (json.data ?? []).map(
    (paper: any): CandidatePaper => ({
      externalId: `semantic_scholar:${paper.paperId}`,
      source: "semantic_scholar",
      title: paper.title ?? "Untitled",
      abstract: paper.abstract ?? null,
      authors: (paper.authors ?? []).map((a: any) => a.name ?? "Unknown"),
      doi: paper.externalIds?.DOI ?? null,
      url: paper.url ?? null,
      openAccessPdfUrl: paper.openAccessPdf?.url ?? null,
      publishedDate: paper.publicationDate ?? null,
      venue: paper.venue ?? null,
      citationCount: paper.citationCount ?? null,
      fieldsOfStudy: paper.fieldsOfStudy ?? [],
    })
  );
}

// ---------- Dedup ----------

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function dedupe(papers: CandidatePaper[]): CandidatePaper[] {
  const seenDois = new Set<string>();
  const seenTitles = new Set<string>();
  const result: CandidatePaper[] = [];

  for (const paper of papers) {
    const doiKey = paper.doi?.toLowerCase();
    const titleKey = normalizeTitle(paper.title);

    if (doiKey && seenDois.has(doiKey)) continue;
    if (!doiKey && seenTitles.has(titleKey)) continue;

    if (doiKey) seenDois.add(doiKey);
    seenTitles.add(titleKey);
    result.push(paper);
  }

  return result;
}

// ---------- Public entry point ----------

/**
 * Fetches candidate papers for one query across OpenAlex and Semantic
 * Scholar, dedupes across sources, and returns them sorted by publish date
 * (newest first). One source failing does not abort the call.
 */
export async function fetchExternalCandidates(
  query: string,
  options: Omit<FetchOptions, "query"> = {}
): Promise<CandidatePaper[]> {
  const fetchOpts: FetchOptions = { ...options, query };

  const [openAlexResult, semanticScholarResult] = await Promise.allSettled([
    fetchFromOpenAlex(fetchOpts),
    fetchFromSemanticScholar(fetchOpts),
  ]);

  const allResults: CandidatePaper[] = [];

  if (openAlexResult.status === "fulfilled") {
    allResults.push(...openAlexResult.value);
  } else {
    console.error(`[externalSources] OpenAlex failed for query "${query}":`, openAlexResult.reason);
  }

  if (semanticScholarResult.status === "fulfilled") {
    allResults.push(...semanticScholarResult.value);
  } else {
    console.error(
      `[externalSources] Semantic Scholar failed for query "${query}":`,
      semanticScholarResult.reason
    );
  }

  const deduped = dedupe(allResults);

  return deduped.sort((a, b) => {
    const dateA = a.publishedDate ? Date.parse(a.publishedDate) : 0;
    const dateB = b.publishedDate ? Date.parse(b.publishedDate) : 0;
    return dateB - dateA;
  });
}

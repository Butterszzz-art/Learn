// News ingestion for the shared pool. Fetched once per interest for
// everyone (not once per person): curated RSS/API sources where one is
// registered, a web-searched roundup otherwise. Each kept item becomes a
// "paper" card; items with a genuinely arguable thesis may also get a
// "debate" card carrying the strongest counterargument.
import { db, client } from "@/db";
import { items } from "@/db/schema";
import type { Category } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { fetchForInterest } from "../fetchers/registry";
import { generateFieldNewsRoundup } from "../newsRoundup";
import { dedupeItems, dedupeKeyFor } from "../dedupe";
import { categorizeByKeywords } from "../categorize";
import { classifyAndSummarizeBatch, summarizeBatch } from "../claude";
import { hasClaudeKey } from "../ai";
import { fetchArticleText } from "../articleFetch";
import { generateSteelmans } from "../steelman";
import { scoreItem } from "../score";
import { indexForSearch } from "../searchIndex";
import { getInterestRow } from "../interests";
import type { InterestRow } from "../interests";
import type { RawItem, ProcessedItem } from "../types";
import type { PaperPayload, SourceBadge, DebatePayload } from "../cardTypes";
import { upsertCard } from "./cards";

const TARGET_ITEMS_PER_INTEREST = 8;
const TARGET_ROUNDUP_ITEMS = 5;
const STEELMAN_ELIGIBLE_SLUGS = new Set(["political-science", "economics", "philosophy", "critical-thinking"]);
const STEELMAN_CANDIDATE_POOL = 8;
const STEELMAN_PER_RUN = 2;

const ROUNDUP_FOCUS_OVERRIDES: Record<string, string> = {
  "critical-thinking":
    "real arguments, claims, or pieces of reasoning currently circulating in public discourse or " +
    "media (op-eds, punditry, marketing claims, political rhetoric, viral social posts, etc.) that " +
    "would make good critical-thinking practice material — not just general commentary about " +
    "critical thinking as a topic",
};

const PREPRINT_SOURCES = /biorxiv|medrxiv|arxiv|ssrn|psyarxiv|preprint/i;

export function badgeFor(sourceType: string, sourceName: string): SourceBadge {
  if (sourceType === "generated") return "ai-roundup";
  if (sourceType === "journalism") return "journalism";
  return PREPRINT_SOURCES.test(sourceName) ? "preprint" : "peer-reviewed";
}

/** First sentence of a summary, used as the card's one-line takeaway. */
export function firstSentence(text: string, max = 180): string {
  const m = text.trim().match(/^.*?[.!?](?=\s|$)/);
  const s = (m ? m[0] : text).trim();
  return s.length <= max ? s : s.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

function truncateSnippet(snippet: string, max = 300): string {
  const s = (snippet || "").trim();
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

// bioRxiv and a few feeds serve the literal string "placeholder" for
// preprints too new to be indexed. Treat it as an empty summary.
const USELESS_SUMMARY_RE = /^placeholder\.?$/i;

function cleanSummary(summary: string | undefined | null, fallbackSnippet: string): string {
  const s = (summary || "").trim();
  if (!s || USELESS_SUMMARY_RE.test(s)) {
    return truncateSnippet(fallbackSnippet) || "No summary available yet — check the source directly.";
  }
  return s;
}

/** Real abstracts are summarized directly; everything else has its article page fetched first. */
async function buildSummaryTexts(raw: RawItem[]): Promise<string[]> {
  return Promise.all(
    raw.map(async (item) => {
      if (item.hasFullAbstract) return item.snippet;
      try {
        return (await fetchArticleText(item.url)) ?? item.snippet;
      } catch {
        return item.snippet;
      }
    })
  );
}

async function filterFresh(rawItems: RawItem[]): Promise<RawItem[]> {
  const deduped = dedupeItems(rawItems);
  if (deduped.length === 0) return [];
  const keys = deduped.map((i) => dedupeKeyFor(i));
  const existing = new Set<string>();
  // Look up only the candidate keys (the old code loaded every key in the table).
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const res = await client.execute({
      sql: `SELECT dedupe_key FROM items WHERE dedupe_key IN (${chunk.map(() => "?").join(",")})`,
      args: chunk,
    });
    for (const r of res.rows as any[]) existing.add(r.dedupe_key);
  }
  return deduped.filter((item) => !existing.has(dedupeKeyFor(item)));
}

export async function paperCardForItem(row: {
  id: number;
  title: string;
  summary: string;
  url: string;
  sourceName: string;
  sourceType: string;
  authors: string | null;
  publishedAt: string | null;
  interestId: number | null;
}): Promise<number> {
  const payload: PaperPayload = {
    url: row.url,
    sourceName: row.sourceName,
    badge: badgeFor(row.sourceType, row.sourceName),
    authors: row.authors,
    publishedAt: row.publishedAt,
    takeaway: firstSentence(row.summary),
  };
  return upsertCard({
    type: "paper",
    interestId: row.interestId,
    level: null,
    itemId: row.id,
    title: row.title,
    body: row.summary,
    payload: payload as unknown as Record<string, unknown>,
    dedupeKey: `item:${row.id}`,
  });
}

async function insertItems(processed: ProcessedItem[], interest: InterestRow): Promise<number> {
  let inserted = 0;
  for (const item of processed) {
    try {
      const row = await db
        .insert(items)
        .values({
          title: item.title,
          authors: item.authors,
          summary: item.summary,
          rawSnippet: item.snippet,
          sourceName: item.sourceName,
          sourceType: item.sourceType,
          category: item.category,
          interestId: interest.id,
          url: item.url,
          dedupeKey: item.dedupeKey,
          publishedAt: item.publishedAt,
          score: item.score,
        })
        .returning({ id: items.id });
      inserted++;
      const cardId = await paperCardForItem({
        id: row[0].id,
        title: item.title,
        summary: item.summary,
        url: item.url,
        sourceName: item.sourceName,
        sourceType: item.sourceType,
        authors: item.authors ?? null,
        publishedAt: item.publishedAt ?? null,
        interestId: interest.id,
      });
      await indexForSearch({
        contentType: "news",
        sourceId: row[0].id,
        title: item.title,
        body: item.summary,
        interestLabel: interest.name,
        interestId: interest.id,
        date: item.publishedAt ?? new Date().toISOString(),
        url: `/card/${cardId}`,
        userId: null,
      });
    } catch (err) {
      // Almost always a dedupe-key race with another worker; skip the item.
      console.error(`[news] skipping "${item.title}":`, err instanceof Error ? err.message : err);
    }
  }
  return inserted;
}

async function runCuratedNews(interest: InterestRow): Promise<{ added: number; fetched: number }> {
  const rawItems = await fetchForInterest(interest.slug);
  if (rawItems.length === 0) return { added: 0, fetched: 0 };
  const fresh = await filterFresh(rawItems);
  if (fresh.length === 0) return { added: 0, fetched: rawItems.length };

  // Shortlist on cheap heuristics first; only the shortlist costs AI calls.
  const candidates = fresh
    .map((item) => ({ item, score: scoreItem(item) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TARGET_ITEMS_PER_INTEREST);
  const shortlist = candidates.map((c) => c.item);
  const summaryTexts = await buildSummaryTexts(shortlist);
  const forSummary = shortlist.map((item, i) => ({ ...item, snippet: summaryTexts[i] }));

  const isNeuro = interest.slug === "neuroscience";
  const neuroResults = isNeuro ? await classifyAndSummarizeBatch(forSummary) : null;
  const otherResults = isNeuro ? null : await summarizeBatch(forSummary);

  const processed: ProcessedItem[] = candidates.map(({ item, score }, idx) => {
    let category: Category | null = null;
    let summary: string;
    if (neuroResults) {
      const r = neuroResults.get(idx);
      category = r?.category ?? categorizeByKeywords(item);
      summary = cleanSummary(r?.summary, item.snippet);
    } else {
      summary = cleanSummary(otherResults?.get(idx), item.snippet);
    }
    return { ...item, category, summary, score, dedupeKey: dedupeKeyFor(item) };
  });
  return { added: await insertItems(processed, interest), fetched: rawItems.length };
}

async function runRoundupNews(interest: InterestRow): Promise<{ added: number; fetched: number }> {
  if (!hasClaudeKey()) return { added: 0, fetched: 0 };
  const rawItems = await generateFieldNewsRoundup(interest.name, ROUNDUP_FOCUS_OVERRIDES[interest.slug]);
  if (rawItems.length === 0) return { added: 0, fetched: 0 };
  const fresh = await filterFresh(rawItems);
  if (fresh.length === 0) return { added: 0, fetched: rawItems.length };

  const summaryTexts = await buildSummaryTexts(fresh);
  const forSummary = fresh.map((item, i) => ({ ...item, snippet: summaryTexts[i] }));
  const results = await summarizeBatch(forSummary);
  const processed: ProcessedItem[] = fresh
    .map((item, idx) => ({
      ...item,
      category: null,
      summary: cleanSummary(results.get(idx), item.snippet),
      score: scoreItem(item),
      dedupeKey: dedupeKeyFor(item),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TARGET_ROUNDUP_ITEMS);
  return { added: await insertItems(processed, interest), fetched: rawItems.length };
}

async function addSteelmans(interest: InterestRow): Promise<number> {
  if (!hasClaudeKey()) return 0;
  if (!STEELMAN_ELIGIBLE_SLUGS.has(interest.slug) && !interest.isCustom) return 0;
  const candidates = await db
    .select({ id: items.id, title: items.title, summary: items.summary, url: items.url, sourceName: items.sourceName })
    .from(items)
    .where(and(eq(items.interestId, interest.id), isNull(items.steelmanContent)))
    .orderBy(desc(items.fetchedAt), desc(items.score))
    .limit(STEELMAN_CANDIDATE_POOL);
  if (candidates.length === 0) return 0;

  const results = await generateSteelmans(
    interest.name,
    candidates.map((c, idx) => ({ index: idx + 1, title: c.title, summary: c.summary }))
  ).catch(() => []);
  let added = 0;
  for (const r of results.slice(0, STEELMAN_PER_RUN)) {
    const c = candidates[r.index - 1];
    if (!c) continue;
    await db.update(items).set({ steelmanContent: r.steelman }).where(eq(items.id, c.id));
    const payload: DebatePayload = { claim: firstSentence(c.summary, 240), url: c.url, sourceName: c.sourceName };
    await upsertCard({
      type: "debate",
      interestId: interest.id,
      level: null,
      itemId: c.id,
      title: c.title,
      body: r.steelman,
      payload: payload as unknown as Record<string, unknown>,
      dedupeKey: `item:${c.id}:debate`,
    });
    added++;
  }
  return added;
}

export interface NewsResult {
  interestId: number;
  added: number;
  fetched: number;
  debates: number;
}

/** Refreshes one interest's news for everyone. */
export async function refreshNews(interestId: number): Promise<NewsResult | null> {
  const interest = await getInterestRow(interestId);
  if (!interest || interest.isLibraryBook) return null;
  const result = await (interest.hasCuratedSource ? runCuratedNews(interest) : runRoundupNews(interest));
  const debates = result.added > 0 ? await addSteelmans(interest).catch(() => 0) : 0;
  return { interestId, ...result, debates };
}

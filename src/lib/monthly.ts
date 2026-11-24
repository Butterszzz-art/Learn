// The Monthly Deep Dive: one long, magazine-style read per interest per
// month on what happened in the field that month — the big story, the
// trends, signals to watch and open questions to ponder.
//
// It is written only from the news items the shared pool already collected
// for that interest during the month (curated fetchers or the web-searched
// Field News Roundup), so every claim traces to a real, dated source and no
// extra search is needed. Like the series, it is written once per interest
// and shared by everyone who follows it.
import { client } from "@/db";
import type { Level } from "@/db/schema";
import { generateJson } from "./ai";
import { getInterestRow } from "./interests";
import { publishDeepDive } from "./engine/series";
import type { SeriesResult } from "./engine/series";

/** One version per interest, pitched at a curious reader with some background. */
export const MONTHLY_LEVEL: Level = "some_background";
/** Below this many items in the month there isn't a month's worth of trends to write about. */
export const MIN_MONTHLY_ITEMS = 8;
/** The entry must actually draw on its material, not lean on one or two items. */
export const MIN_CITED_SOURCES = 5;
const MAX_ITEMS_IN_PROMPT = 40;
const ABSTRACT_CHARS = 900;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-10" → "October 2026". */
export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${MONTH_NAMES[(m ?? 1) - 1] ?? "?"} ${y}`;
}

/** The calendar month before `now`, as "YYYY-MM" (UTC). */
export function previousPeriod(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function isPeriod(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export interface MonthItem {
  id: number;
  title: string;
  summary: string;
  abstract: string | null; // the source's own snippet/abstract, when the fetcher kept one
  sourceName: string;
  url: string;
  date: string | null;
}

/** The month's items for an interest, best-scored first. */
export async function getMonthItems(interestId: number, period: string, limit = MAX_ITEMS_IN_PROMPT): Promise<MonthItem[]> {
  const res = await client.execute({
    sql: `SELECT id, title, summary, raw_snippet, source_name, url, published_at
          FROM items WHERE interest_id = ? AND substr(fetched_at, 1, 7) = ?
          ORDER BY score DESC, id DESC LIMIT ?`,
    args: [interestId, period, limit],
  });
  return (res.rows as any[]).map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    summary: String(r.summary ?? ""),
    abstract: r.raw_snippet ? String(r.raw_snippet).slice(0, ABSTRACT_CHARS) : null,
    sourceName: String(r.source_name ?? ""),
    url: String(r.url),
    date: r.published_at ? String(r.published_at).slice(0, 10) : null,
  }));
}

export async function countMonthItems(interestId: number, period: string): Promise<number> {
  const res = await client.execute({
    sql: "SELECT COUNT(*) AS n FROM items WHERE interest_id = ? AND substr(fetched_at, 1, 7) = ?",
    args: [interestId, period],
  });
  return Number((res.rows[0] as any)?.n ?? 0);
}

export async function findMonthlyDive(interestId: number, period: string): Promise<{ id: number; topic: string; status: string } | null> {
  const res = await client.execute({
    sql: "SELECT id, topic, status FROM deep_dives WHERE origin = 'monthly' AND interest_id = ? AND period = ? LIMIT 1",
    args: [interestId, period],
  });
  const r = res.rows[0] as any;
  return r ? { id: Number(r.id), topic: String(r.topic), status: String(r.status) } : null;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface MonthlyDraft {
  headline: string;
  standfirst: string;
  bigStory: { heading: string; body: string };
  trends: { heading: string; body: string; science: string }[];
  signals: string[];
  ponder: string[];
}

const SYSTEM =
  "You are the science editor of a learning app, writing its Monthly Deep Dive: a long, lively, " +
  "magazine-style feature on what happened in one field over the past month. Your voice mixes a good " +
  "science journalist (a hook, narrative, why it matters to a person) with a scientist's care (mechanisms, " +
  "evidence, honest uncertainty). You write ONLY from the numbered source items you are given. Every factual " +
  "claim about a development must cite the item it comes from as [n]. Never invent a study, number, quote, " +
  "person or result that is not in the items; background knowledge is fine for explaining how things work, " +
  "but not for adding news. Specific details of a study (its methods, numbers, mechanisms, which cells or " +
  "regions) must come from that item's own text; if the item doesn't say it, don't attribute it to the study. " +
  "If the items don't support a trend, don't claim one.";

const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "A punchy, specific headline for the month, under 90 characters. Not clickbait." },
    standfirst: { type: "string", description: "One or two sentences under the headline: why this month mattered in the field." },
    bigStory: {
      type: "object",
      description: "The month's single most important or interesting development, told as a narrative.",
      properties: {
        heading: { type: "string", description: "Section heading, under 70 characters." },
        body: { type: "string", description: "350-550 words of markdown paragraphs (no headings), citing items as [n]." },
      },
      required: ["heading", "body"],
      additionalProperties: false,
    },
    trends: {
      type: "array",
      description: "3 or 4 distinct trends that several items point to. Each groups related items; don't repeat the big story.",
      items: {
        type: "object",
        properties: {
          heading: { type: "string", description: "Section heading naming the trend, under 70 characters." },
          body: { type: "string", description: "180-300 words of markdown paragraphs (no headings): what happened, and why it matters. Cite items as [n]." },
          science: { type: "string", description: "40-90 words: the underlying mechanism or concept a reader needs to really understand this trend." },
        },
        required: ["heading", "body", "science"],
        additionalProperties: false,
      },
    },
    signals: {
      type: "array",
      items: { type: "string" },
      description: "2-4 one-sentence early signals worth watching next month — small items that might grow. Cite as [n].",
    },
    ponder: {
      type: "array",
      items: { type: "string" },
      description: "2 or 3 genuinely open questions the month raises, with no single right answer, that a thoughtful reader could chew on. One sentence each, no citations.",
    },
  },
  required: ["headline", "standfirst", "bigStory", "trends", "signals", "ponder"],
  additionalProperties: false,
} as const;

function buildPrompt(interestName: string, period: string, items: MonthItem[]): string {
  const list = items
    .map((it, i) => {
      const abstract = it.abstract && it.abstract !== it.summary ? `\n    Source text: ${it.abstract}` : "";
      return `[${i + 1}] ${it.title}\n    ${it.sourceName}${it.date ? `, ${it.date}` : ""}\n    Summary: ${it.summary}${abstract}`;
    })
    .join("\n\n");
  return (
    `Write the Monthly Deep Dive for ${interestName}, covering ${periodLabel(period)}.\n\n` +
    "The reader is curious and has some background in the field: use its vocabulary, but explain any " +
    "genuinely advanced idea. Aim for a 10-15 minute read that leaves them seeing the field differently.\n\n" +
    `Cite at least ${MIN_CITED_SOURCES} different items, using only the numbers below.\n\n` +
    `This month's items (${items.length}):\n\n${list}`
  );
}

/** Pulls every [n] / [n, m] citation number out of a piece of text. */
export function citedNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    for (const n of m[1].split(",")) out.push(Number(n.trim()));
  }
  return out;
}

/**
 * Turns the draft into the stored entry: markdown body plus the cited
 * sources, renumbered in order of first citation and linked inline.
 * Citations to items that don't exist are dropped. Returns null if too few
 * real items were cited.
 */
export function assembleMonthly(
  draft: MonthlyDraft,
  items: MonthItem[]
): { topic: string; content: string; sources: { title: string; url: string }[]; essayPrompt: string | null } | null {
  const sections: string[] = [];
  sections.push(`*${draft.standfirst.trim()}*`);
  sections.push(`## ${draft.bigStory.heading.trim()}\n\n${draft.bigStory.body.trim()}`);
  for (const t of draft.trends) {
    sections.push(`## ${t.heading.trim()}\n\n${t.body.trim()}\n\n> **The science behind it.** ${t.science.trim()}`);
  }
  if (draft.signals.length > 0) sections.push(`## Signals to watch\n\n${draft.signals.map((s) => `- ${s.trim()}`).join("\n")}`);
  const ponder = draft.ponder.map((q) => q.trim()).filter(Boolean);
  if (ponder.length > 0) sections.push(`## Questions to ponder\n\n${ponder.map((q) => `- ${q}`).join("\n")}`);
  const raw = sections.join("\n\n");

  // Renumber: the first item cited becomes [1], and so on.
  const order: number[] = [];
  for (const n of citedNumbers(raw)) {
    if (n >= 1 && n <= items.length && !order.includes(n)) order.push(n);
  }
  if (order.length < Math.min(MIN_CITED_SOURCES, items.length)) return null;

  const content = raw.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_m, group: string) => {
    const links = group
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => order.includes(n))
      .map((n) => `[[${order.indexOf(n) + 1}]](${items[n - 1].url})`);
    return links.join("");
  });

  return {
    topic: draft.headline.trim(),
    content,
    sources: order.map((n) => ({ title: `${items[n - 1].title} (${items[n - 1].sourceName})`, url: items[n - 1].url })),
    essayPrompt: ponder[0] ?? null,
  };
}

/**
 * Writes and publishes one interest's Monthly Deep Dive for `period`.
 * Idempotent: returns the existing entry if there already is one. Returns
 * null when generation failed (so the job retries), and `{ skipped }` when
 * the month simply doesn't have enough material (finished, not retried).
 */
export async function generateMonthlyDeepDive(
  interestId: number,
  period: string
): Promise<SeriesResult | { skipped: string } | null> {
  if (!isPeriod(period)) throw new Error(`Not a month: ${period}`);
  const existing = await findMonthlyDive(interestId, period);
  if (existing) return { deepDiveId: existing.id, topic: existing.topic, cards: 0, flagged: existing.status === "flagged" };

  const interest = await getInterestRow(interestId);
  if (!interest || interest.isLibraryBook) return { skipped: `no interest ${interestId}` };
  const items = await getMonthItems(interestId, period);
  if (items.length < MIN_MONTHLY_ITEMS) {
    return { skipped: `only ${items.length} items for ${interest.name} in ${period}; need ${MIN_MONTHLY_ITEMS}` };
  }

  // Sustained writing with judgment: the "main" tier, same as a deep dive.
  const draft = await generateJson<MonthlyDraft>({
    tier: "main",
    system: SYSTEM,
    schema: SCHEMA as unknown as Record<string, unknown>,
    prompt: buildPrompt(interest.name, period, items),
    maxTokens: 8000,
  });
  if (!draft) return null;
  const assembled = assembleMonthly(draft, items);
  if (!assembled) {
    console.error(`[monthly] ${interest.name} ${period}: too few valid citations, retrying later`);
    return null;
  }
  return publishDeepDive(
    interest,
    MONTHLY_LEVEL,
    { topic: assembled.topic, content: assembled.content, sources: assembled.sources },
    "monthly",
    { period, essayPrompt: assembled.essayPrompt }
  );
}

// ---------------------------------------------------------------------------
// Reading side
// ---------------------------------------------------------------------------

export interface MonthlyEntry {
  id: number;
  topic: string;
  period: string;
  interestId: number;
  interestName: string;
  createdAt: string;
}

/**
 * The most recent month's Monthly Deep Dives for the interests a person
 * follows (empty if none were published in the last `withinDays` days).
 */
export async function getLatestMonthlyForUser(userId: number, withinDays = 31): Promise<MonthlyEntry[]> {
  const since = new Date(Date.now() - withinDays * 86400000).toISOString().slice(0, 19).replace("T", " ");
  const res = await client.execute({
    sql: `SELECT d.id, d.topic, d.period, d.interest_id, d.created_at, i.name
          FROM deep_dives d
          JOIN interests i ON i.id = d.interest_id
          JOIN user_interest_prefs p ON p.interest_id = d.interest_id AND p.user_id = ? AND p.enabled = 1
          WHERE d.origin = 'monthly' AND d.status = 'published' AND d.created_at >= ?
          ORDER BY d.period DESC, p.is_favorite DESC, d.id DESC`,
    args: [userId, since],
  });
  const rows = (res.rows as any[]).map((r) => ({
    id: Number(r.id),
    topic: String(r.topic),
    period: String(r.period),
    interestId: Number(r.interest_id),
    interestName: String(r.name),
    createdAt: String(r.created_at),
  }));
  const latest = rows[0]?.period;
  return rows.filter((r) => r.period === latest);
}

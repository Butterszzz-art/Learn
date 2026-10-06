import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "./claude";
import type { RawItem } from "./types";
import { getModel } from "./modelConfig";
import { cachedSystem } from "./promptCache";

const MAX_RESUME_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Phase 14 — split the same way as Deep Dive (see deepDive.ts's module
// comment): a synchronous, web_search-using gather step finds and verifies
// real items; a no-tools, batch-eligible write step turns each one's raw
// notes into the final 2-3 sentence summary. generateFieldNewsRoundup
// (bottom of this file) composes both for callers needing an immediate
// result; the scheduled batch pipeline calls gatherFieldNews directly and
// queues buildFieldNewsWriteParams through the Batches API instead.
// ---------------------------------------------------------------------------

const GATHER_SYSTEM_PROMPT =
  "You research real, current, verifiable developments in a field, for a personal knowledge feed. " +
  "Every item must come from an actual web search result with a real, working URL — never invent a " +
  "source, a URL, or a detail. Gather factual notes for each item; someone else writes the final " +
  "summary from what you gather.";

function buildGatherPrompt(interestName: string, focusOverride?: string): string {
  const subject = focusOverride ?? `real, current, dated developments, news items, or notable recent ` +
    `happenings in the field of "${interestName}"`;
  return (
    `Search for 3 to 5 ${subject}. Use web search to confirm each one is real and to get a ` +
    "genuine, working source URL — never invent one.\n\n" +
    "Respond with exactly one block per item, in this format, separated by a line containing only " +
    "three dashes (---):\n\n" +
    "TITLE: <concise title>\n" +
    "DATE: <YYYY-MM-DD if known, otherwise your best approximation>\n" +
    "SOURCE: <the publication or outlet name>\n" +
    "URL: <the real URL you found via search>\n" +
    "NOTES: <the actual facts/findings from the source, in enough detail for someone else to write a " +
    "2-3 sentence summary from — not the summary itself>\n" +
    "---\n" +
    "TITLE: <next item>\n" +
    "...\n\n" +
    "Only include items you actually found via search with a real, working URL. If you can only find " +
    "2 solid, verifiable items, that's fine — do not pad with weaker or fabricated items to reach 5."
  );
}

export interface GatheredNewsItem {
  title: string;
  date?: string;
  source: string;
  url: string;
  notes: string;
}

/**
 * Step 1 (synchronous, web_search): finds 3-5 real, current, verifiable
 * items for an interest with no registered fetcher and gathers factual
 * notes on each — not the final summary. Returns [] if no API key is
 * configured or generation fails.
 */
export async function gatherFieldNews(interestName: string, focusOverride?: string): Promise<GatheredNewsItem[]> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return [];

  try {
    let messages: Anthropic.MessageParam[] = [{ role: "user", content: buildGatherPrompt(interestName, focusOverride) }];
    let response = await anthropic.messages.create({
      model: getModel("gather"),
      max_tokens: 3072,
      system: cachedSystem(GATHER_SYSTEM_PROMPT),
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
      output_config: { effort: "medium" },
      messages,
    });

    let resumeAttempts = 0;
    while (response.stop_reason === "pause_turn" && resumeAttempts < MAX_RESUME_ATTEMPTS) {
      messages = [...messages, { role: "assistant", content: response.content }];
      response = await anthropic.messages.create({
        model: getModel("gather"),
        max_tokens: 3072,
        system: cachedSystem(GATHER_SYSTEM_PROMPT),
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
        output_config: { effort: "medium" },
        messages,
      });
      resumeAttempts++;
    }

    if (response.stop_reason === "refusal") {
      console.error(`[newsRoundup] Claude refused to gather a roundup for "${interestName}".`);
      return [];
    }

    const fullText = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n\n")
      .trim();

    return parseGatherResponse(fullText).slice(0, 5);
  } catch (err) {
    console.error(`[newsRoundup] Gathering failed for "${interestName}":`, err);
    return [];
  }
}

function parseGatherResponse(fullText: string): GatheredNewsItem[] {
  const blocks = fullText.split(/\n-{3,}\n/);
  const items: GatheredNewsItem[] = [];
  for (const block of blocks) {
    const title = block.match(/^TITLE:\s*(.+)$/m)?.[1]?.trim();
    const date = block.match(/^DATE:\s*(.+)$/m)?.[1]?.trim();
    const source = block.match(/^SOURCE:\s*(.+)$/m)?.[1]?.trim();
    const url = block.match(/^URL:\s*(\S+)$/m)?.[1]?.trim();
    const notesMatch = block.match(/^NOTES:\s*([\s\S]*)$/m);
    const notes = notesMatch?.[1]?.trim();
    if (!title || !url || !notes || !/^https?:\/\//.test(url)) continue;
    items.push({ title, date, source: source || "Web search", url, notes });
  }
  return items;
}

const WRITE_SYSTEM_PROMPT =
  "You write short, punchy summaries for a personal knowledge feed's Field News Roundup, from real, " +
  "already-verified research notes handed to you by a separate research step. Write in your own " +
  "words — never copy sentences verbatim from the notes.";

const WRITE_SCHEMA = {
  type: "object" as const,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          summary: { type: "string", description: "2-3 sentences, in your own words, from the given notes." },
        },
        required: ["index", "summary"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

/**
 * Step 2 (no tools, batch-eligible): builds the request params that turn a
 * gather step's raw notes into the final short summaries, one call for the
 * whole batch of items — shared by the synchronous path (writeFieldNews,
 * below) and the Batches API path (see scripts/submitBatch.ts).
 */
export function buildFieldNewsWriteParams(items: GatheredNewsItem[]): Anthropic.MessageCreateParamsNonStreaming {
  const itemsForPrompt = items.map((item, i) => ({ index: i, title: item.title, source: item.source, notes: item.notes }));
  return {
    model: getModel("news_summary"),
    max_tokens: 2048,
    system: cachedSystem(WRITE_SYSTEM_PROMPT),
    output_config: { format: { type: "json_schema", schema: WRITE_SCHEMA } },
    messages: [{ role: "user", content: "Items:\n" + JSON.stringify(itemsForPrompt, null, 2) }],
  };
}

export function parseFieldNewsWriteResult(text: string): Map<number, string> {
  const parsed = JSON.parse(text) as { results: { index: number; summary: string }[] };
  const map = new Map<number, string>();
  for (const r of parsed.results) map.set(r.index, r.summary);
  return map;
}

/** Turns gathered items into RawItem[] once each has a written summary —
 * shared by the synchronous composition below and the batch writer. */
export function toRawItems(items: GatheredNewsItem[], summaries: Map<number, string>): RawItem[] {
  return items.map((item, i) => ({
    title: item.title,
    snippet: summaries.get(i) ?? item.notes,
    url: item.url,
    publishedAt: normalizeDate(item.date),
    sourceName: item.source,
    sourceType: "generated",
  }));
}

async function writeFieldNews(items: GatheredNewsItem[]): Promise<Map<number, string>> {
  const anthropic = getAnthropicClient();
  if (!anthropic || items.length === 0) return new Map();
  try {
    const response = await anthropic.messages.create(buildFieldNewsWriteParams(items));
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return new Map();
    return parseFieldNewsWriteResult(textBlock.text);
  } catch (err) {
    console.error("[newsRoundup] Write step failed:", err);
    return new Map();
  }
}

/**
 * Generates a "Field News Roundup" for an interest with no registered RSS
 * fetcher — 3-5 real, current, web-search-grounded developments, each
 * shaped like a RawItem so it can flow through the same dedupe/score/render
 * pipeline as fetched items. Synchronous gather-then-write composition, for
 * callers needing an immediate result (the manual "Refresh now" path — see
 * pipeline.ts). The scheduled batch pipeline calls gatherFieldNews directly
 * instead and queues the write step through the Batches API (see
 * scripts/submitBatch.ts).
 */
export async function generateFieldNewsRoundup(interestName: string, focusOverride?: string): Promise<RawItem[]> {
  const gathered = await gatherFieldNews(interestName, focusOverride);
  if (gathered.length === 0) return [];
  const summaries = await writeFieldNews(gathered);
  return toRawItems(gathered, summaries);
}

function normalizeDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

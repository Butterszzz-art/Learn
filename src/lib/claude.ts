import Anthropic from "@anthropic-ai/sdk";
import type { Category } from "@/db/schema";
import { CATEGORIES } from "@/db/schema";
import type { RawItem } from "./types";
import { getModel } from "./modelConfig";
import { cachedSystem } from "./promptCache";
import { completeJson, hasSummaryLlm, inventedNumbers } from "./summaryLlm";

let client: Anthropic | null | undefined;

/** Returns a shared client, or null if no API key is configured. */
export function getAnthropicClient(): Anthropic | null {
  if (client !== undefined) return client;
  if (!process.env.ANTHROPIC_API_KEY) {
    client = null;
    return client;
  }
  client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export function hasClaudeKey(): boolean {
  return getAnthropicClient() !== null;
}

interface ClassifiedItem {
  category: Category;
  summary: string;
}

export const BATCH_SIZE = 12;

// Phase 10: News summaries widened from a 2-3 sentence blurb to a genuine
// abstract-style summary — substantial enough to learn the actual finding
// from the card itself. Applies uniformly to every News source; what
// differs per source is the *input* text (a real structured abstract for
// academic sources, a fetched-and-extracted article page for everything
// else — see buildSummaryTexts in pipeline.ts), not this target.
// Phase 16: widened again from 120-200 to 250-320 ("Extended") after
// side-by-side previews at four lengths — this range fit the target of
// detailed/extensive without getting too dense to skim.
const SUMMARY_LENGTH_INSTRUCTION =
  "A detailed, extensive abstract-style summary of 250-320 words, written in your own words, as three " +
  "paragraphs separated by a blank line: (1) background and motivation; (2) what was done and found — " +
  "design, sample, methods, and every key result including secondary findings; (3) why it matters and " +
  "what it implies, plus any caveats the source itself states. " +
  "Carry over real numbers, statistics, effect sizes, and percentages from the source when present " +
  "— factual data points are expected and fine to include — but NEVER invent or estimate a number, " +
  "sample size, p-value, or finding that is not in the source text; if the source gives no sample " +
  "size, do not state one. What must be original is the phrasing and structure: never mirror the " +
  "source text's sentence structure, and never lift phrases from it. A summary under 250 words is a failure.";

// Phase 14: pulled out into its own `system` block (cached — identical on
// every call) rather than folded into the per-call user message, which used
// to repeat this same instruction text verbatim on every single chunk call.
const CLASSIFY_SYSTEM_PROMPT =
  "You are helping compile a personal neuroscience news digest. For each item given, classify it " +
  "into exactly one category and write a summary in your own words. " +
  `${SUMMARY_LENGTH_INSTRUCTION} The provided text may be a real abstract, or text auto-extracted ` +
  "from a webpage that can still contain some navigation/boilerplate — focus only on the actual " +
  `article content.\n\nCategories: ${CATEGORIES.join(" | ")}`;

const SUMMARIZE_SYSTEM_PROMPT =
  "You are helping compile a personal knowledge digest. For each item given, write a summary in " +
  `your own words. ${SUMMARY_LENGTH_INSTRUCTION} The provided text may be a real abstract, or text ` +
  "auto-extracted from a webpage that can still contain some navigation/boilerplate — focus only on " +
  "the actual article content.";

const CLASSIFY_SCHEMA = {
  type: "object" as const,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          category: { type: "string", enum: [...CATEGORIES] },
          summary: { type: "string", description: SUMMARY_LENGTH_INSTRUCTION },
        },
        required: ["index", "category", "summary"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

const SUMMARIZE_SCHEMA = {
  type: "object" as const,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          summary: { type: "string", description: SUMMARY_LENGTH_INSTRUCTION },
        },
        required: ["index", "summary"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

function itemsForPrompt(chunk: RawItem[]) {
  return chunk.map((item, i) => ({
    index: i,
    title: item.title,
    source: item.sourceName,
    text: (item.snippet || "").slice(0, 6000),
  }));
}

/**
 * Builds the exact request params for a classify-and-summarize chunk call —
 * shared by the synchronous path (classifyChunk, below) and the Batches API
 * path (news summary generation for curated sources is batch-eligible per
 * Phase 14 — see scripts/submitBatch.ts). Same params either way; the only
 * difference is whether they're passed to `messages.create` directly or
 * wrapped into a Batches API `requests[]` entry.
 */
export function buildClassifyChunkParams(chunk: RawItem[]): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: getModel("news_summary"),
    max_tokens: 8192,
    system: cachedSystem(CLASSIFY_SYSTEM_PROMPT),
    output_config: { format: { type: "json_schema", schema: CLASSIFY_SCHEMA } },
    messages: [{ role: "user", content: "Items:\n" + JSON.stringify(itemsForPrompt(chunk), null, 2) }],
  };
}

export function buildSummarizeChunkParams(chunk: RawItem[]): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: getModel("news_summary"),
    max_tokens: 8192,
    system: cachedSystem(SUMMARIZE_SYSTEM_PROMPT),
    output_config: { format: { type: "json_schema", schema: SUMMARIZE_SCHEMA } },
    messages: [{ role: "user", content: "Items:\n" + JSON.stringify(itemsForPrompt(chunk), null, 2) }],
  };
}

export function parseClassifyChunkResult(text: string): Map<number, ClassifiedItem> {
  const parsed = JSON.parse(text) as { results: { index: number; category: string; summary: string }[] };
  const map = new Map<number, ClassifiedItem>();
  for (const r of parsed.results) {
    if (!(CATEGORIES as readonly string[]).includes(r.category)) continue;
    map.set(r.index, { category: r.category as Category, summary: r.summary });
  }
  return map;
}

export function parseSummarizeChunkResult(text: string): Map<number, string> {
  const parsed = JSON.parse(text) as { results: { index: number; summary: string }[] };
  const map = new Map<number, string>();
  for (const r of parsed.results) map.set(r.index, r.summary);
  return map;
}

const SINGLE_CLASSIFY_SCHEMA = {
  type: "object" as const,
  properties: {
    category: { type: "string", enum: [...CATEGORIES] },
    summary: { type: "string", description: SUMMARY_LENGTH_INSTRUCTION },
  },
  required: ["category", "summary"],
  additionalProperties: false,
};

const SINGLE_SUMMARIZE_SCHEMA = {
  type: "object" as const,
  properties: { summary: { type: "string", description: SUMMARY_LENGTH_INSTRUCTION } },
  required: ["summary"],
  additionalProperties: false,
};

function singleItemPrompt(item: RawItem): string {
  return `Title: ${item.title}\nSource: ${item.sourceName}\nText: ${(item.snippet || "").slice(0, 6000)}`;
}

const MIN_ACCEPTED_WORDS = 200;
const MAX_SUMMARY_ATTEMPTS = 3;

// Smaller open models sometimes undershoot the length or invent statistics
// (sample sizes, p-values) that the source never gave — unacceptable in a
// science digest. Retry such output; if no attempt is clean, return null so the
// caller falls back to the real (truncated) abstract instead of fabricated numbers.
async function guarded<T extends { summary: string }>(item: RawItem, attempt: () => Promise<T | null>): Promise<T | null> {
  const source = `${item.title} ${(item.snippet || "").slice(0, 6000)}`;
  for (let i = 0; i < MAX_SUMMARY_ATTEMPTS; i++) {
    const result = await attempt();
    if (!result) continue;
    const words = result.summary.trim().split(/\s+/).length;
    if (words >= MIN_ACCEPTED_WORDS && inventedNumbers(result.summary, source).length === 0) return result;
  }
  return null;
}

// Sequential on purpose — the OpenAI-compatible provider path is paced by
// token-per-minute limits (see summaryLlm.ts), so concurrency just trips 429s.
async function viaSummaryLlm<T>(items: RawItem[], run: (item: RawItem) => Promise<T | null>): Promise<Map<number, T>> {
  const results = new Map<number, T>();
  for (let i = 0; i < items.length; i++) {
    try {
      const value = await run(items[i]);
      if (value) results.set(i, value);
    } catch (err) {
      console.error(`[summaryLlm] "${items[i].title.slice(0, 60)}" failed, will fall back for this item:`, err);
    }
  }
  return results;
}

/**
 * Classifies + summarizes a batch of items in as few API calls as possible.
 * Falls back gracefully (returns an empty map) if no key is configured or a
 * batch call fails — the caller applies the keyword/snippet fallback for any
 * items missing from the returned map. Synchronous path only — the
 * scheduled pipeline instead queues buildClassifyChunkParams calls through
 * the Batches API (see scripts/submitBatch.ts); this stays synchronous for
 * the on-demand "Refresh now" path, which needs an immediate result.
 */
export async function classifyAndSummarizeBatch(
  items: RawItem[]
): Promise<Map<number, ClassifiedItem>> {
  if (hasSummaryLlm()) {
    return viaSummaryLlm(items, (item) =>
      guarded(item, async () => {
        const r = await completeJson<{ category: string; summary: string }>(
          CLASSIFY_SYSTEM_PROMPT,
          singleItemPrompt(item),
          SINGLE_CLASSIFY_SCHEMA
        );
        if (!r.summary?.trim() || !(CATEGORIES as readonly string[]).includes(r.category)) return null;
        return { category: r.category as Category, summary: r.summary.trim() };
      })
    );
  }

  const anthropic = getAnthropicClient();
  const results = new Map<number, ClassifiedItem>();
  if (!anthropic || items.length === 0) return results;

  const chunkStarts: number[] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) chunkStarts.push(i);

  // Chunks run concurrently — each is an independent API call, so there's
  // no reason to wait for one before starting the next.
  await Promise.all(
    chunkStarts.map(async (offset) => {
      const chunk = items.slice(offset, offset + BATCH_SIZE);
      try {
        const response = await anthropic.messages.create(buildClassifyChunkParams(chunk));
        const textBlock = response.content.find((b) => b.type === "text");
        if (!textBlock || textBlock.type !== "text") return;
        parseClassifyChunkResult(textBlock.text).forEach((value, idx) => results.set(offset + idx, value));
      } catch (err) {
        console.error("[claude] classifyChunk failed, will fall back for this batch:", err);
      }
    })
  );

  return results;
}

/**
 * Abstract-style summarization (see SUMMARY_LENGTH_INSTRUCTION) for
 * interests that don't use the fixed neuroscience category taxonomy —
 * every interest other than Neuroscience, plus Field News Roundup items.
 * Same batching/fallback contract as classifyAndSummarizeBatch: returns an
 * empty map on no-key or failure, caller falls back to a truncated snippet.
 * Synchronous path only — see the docstring above.
 */
export async function summarizeBatch(items: RawItem[]): Promise<Map<number, string>> {
  if (hasSummaryLlm()) {
    const guardedResults = await viaSummaryLlm(items, (item) =>
      guarded(item, async () => {
        const r = await completeJson<{ summary: string }>(
          SUMMARIZE_SYSTEM_PROMPT,
          singleItemPrompt(item),
          SINGLE_SUMMARIZE_SCHEMA
        );
        return r.summary?.trim() ? { summary: r.summary.trim() } : null;
      })
    );
    return new Map([...guardedResults].map(([i, r]) => [i, r.summary]));
  }

  const anthropic = getAnthropicClient();
  const results = new Map<number, string>();
  if (!anthropic || items.length === 0) return results;

  const chunkStarts: number[] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) chunkStarts.push(i);

  await Promise.all(
    chunkStarts.map(async (offset) => {
      const chunk = items.slice(offset, offset + BATCH_SIZE);
      try {
        const response = await anthropic.messages.create(buildSummarizeChunkParams(chunk));
        const textBlock = response.content.find((b) => b.type === "text");
        if (!textBlock || textBlock.type !== "text") return;
        parseSummarizeChunkResult(textBlock.text).forEach((value, idx) => results.set(offset + idx, value));
      } catch (err) {
        console.error("[claude] summarizeChunk failed, will fall back for this batch:", err);
      }
    })
  );

  return results;
}

/**
 * Generates a handful of new candidate brain facts, with a basic
 * plausibility check applied by the caller before they're appended to the
 * bank. Returns [] if no API key is configured or generation fails —
 * callers should never block digest generation on this.
 */
export async function generateCandidateBrainFacts(
  existingSample: string[],
  count = 8
): Promise<{ text: string; topic: string }[]> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return [];

  try {
    const response = await anthropic.messages.create({
      model: getModel("brain_game"), // Haiku tier — light generative task, same bucket as brain games
      max_tokens: 2048,
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              facts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    text: { type: "string" },
                    topic: {
                      type: "string",
                      description:
                        "One free-form lowercase tag, e.g. plasticity, memory, sleep, perception, cognition, development, general.",
                    },
                  },
                  required: ["text", "topic"],
                  additionalProperties: false,
                },
              },
            },
            required: ["facts"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "user",
          content:
            `Generate ${count} new, verifiably true, well-established facts about the brain — ` +
            "covering topics like plasticity, cognitive limits/potential, memory, sleep, or perception. " +
            "Each should be one or two sentences, textbook-level and non-contested (no fringe claims, " +
            "no urban myths like the '10% of the brain' claim, no unreplicated single-study findings " +
            "stated as settled fact). Avoid duplicating the meaning of any of these existing facts:\n\n" +
            existingSample.map((f) => `- ${f}`).join("\n"),
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return [];
    const parsed = JSON.parse(textBlock.text) as { facts: { text: string; topic: string }[] };
    return parsed.facts.filter((f) => plausibilityCheck(f.text));
  } catch (err) {
    console.error("[claude] generateCandidateBrainFacts failed:", err);
    return [];
  }
}

/**
 * A deliberately conservative sanity filter — this is NOT fact verification,
 * just a guard against obviously malformed or low-effort generated output
 * before it's appended to the bank (per the spec: no live-generated facts
 * go straight to the display without this check).
 */
function plausibilityCheck(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 40 || trimmed.length > 400) return false;
  if (/as an ai|i cannot|i don't have|i'm not sure/i.test(trimmed)) return false;
  if (!/[.!]$/.test(trimmed)) return false;
  return true;
}

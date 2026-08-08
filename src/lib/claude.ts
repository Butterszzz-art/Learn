import Anthropic from "@anthropic-ai/sdk";
import type { Category } from "@/db/schema";
import { CATEGORIES } from "@/db/schema";
import type { RawItem } from "./types";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

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

const BATCH_SIZE = 12;

/**
 * Classifies + summarizes a batch of items in as few API calls as possible.
 * Falls back gracefully (returns an empty map) if no key is configured or a
 * batch call fails — the caller applies the keyword/snippet fallback for any
 * items missing from the returned map.
 */
export async function classifyAndSummarizeBatch(
  items: RawItem[]
): Promise<Map<number, ClassifiedItem>> {
  const anthropic = getAnthropicClient();
  const results = new Map<number, ClassifiedItem>();
  if (!anthropic || items.length === 0) return results;

  const chunks: RawItem[][] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    chunks.push(items.slice(i, i + BATCH_SIZE));
  }

  for (const chunk of chunks) {
    const offset = items.indexOf(chunk[0]);
    try {
      const classified = await classifyChunk(anthropic, chunk);
      classified.forEach((value, idx) => results.set(offset + idx, value));
    } catch (err) {
      console.error("[claude] classifyChunk failed, will fall back for this batch:", err);
    }
  }

  return results;
}

async function classifyChunk(
  anthropic: Anthropic,
  chunk: RawItem[]
): Promise<Map<number, ClassifiedItem>> {
  const itemsForPrompt = chunk.map((item, i) => ({
    index: i,
    title: item.title,
    source: item.sourceName,
    text: (item.snippet || "").slice(0, 1200),
  }));

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer" },
                  category: { type: "string", enum: [...CATEGORIES] },
                  summary: {
                    type: "string",
                    description:
                      "A 2-3 sentence plain-language summary written in the app's own words, never copied verbatim from the source text.",
                  },
                },
                required: ["index", "category", "summary"],
                additionalProperties: false,
              },
            },
          },
          required: ["results"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: "user",
        content:
          "You are helping compile a personal neuroscience news digest. For each item below, " +
          "classify it into exactly one category and write a plain-language 2-3 sentence summary " +
          "in your own words (never copy sentences verbatim from the provided text).\n\n" +
          `Categories: ${CATEGORIES.join(" | ")}\n\n` +
          "Items:\n" +
          JSON.stringify(itemsForPrompt, null, 2),
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return new Map();

  const parsed = JSON.parse(textBlock.text) as {
    results: { index: number; category: string; summary: string }[];
  };

  const map = new Map<number, ClassifiedItem>();
  for (const r of parsed.results) {
    if (!(CATEGORIES as readonly string[]).includes(r.category)) continue;
    map.set(r.index, { category: r.category as Category, summary: r.summary });
  }
  return map;
}

/**
 * Plain 2-3 sentence summarization for interests that don't use the fixed
 * neuroscience category taxonomy — every interest other than Neuroscience.
 * Same batching/fallback contract as classifyAndSummarizeBatch: returns an
 * empty map on no-key or failure, caller falls back to a truncated snippet.
 */
export async function summarizeBatch(items: RawItem[]): Promise<Map<number, string>> {
  const anthropic = getAnthropicClient();
  const results = new Map<number, string>();
  if (!anthropic || items.length === 0) return results;

  const chunks: RawItem[][] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    chunks.push(items.slice(i, i + BATCH_SIZE));
  }

  for (const chunk of chunks) {
    const offset = items.indexOf(chunk[0]);
    try {
      const summarized = await summarizeChunk(anthropic, chunk);
      summarized.forEach((value, idx) => results.set(offset + idx, value));
    } catch (err) {
      console.error("[claude] summarizeChunk failed, will fall back for this batch:", err);
    }
  }

  return results;
}

async function summarizeChunk(anthropic: Anthropic, chunk: RawItem[]): Promise<Map<number, string>> {
  const itemsForPrompt = chunk.map((item, i) => ({
    index: i,
    title: item.title,
    source: item.sourceName,
    text: (item.snippet || "").slice(0, 1200),
  }));

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer" },
                  summary: {
                    type: "string",
                    description:
                      "A 2-3 sentence plain-language summary written in the app's own words, never copied verbatim from the source text.",
                  },
                },
                required: ["index", "summary"],
                additionalProperties: false,
              },
            },
          },
          required: ["results"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: "user",
        content:
          "You are helping compile a personal knowledge digest. For each item below, write a " +
          "plain-language 2-3 sentence summary in your own words (never copy sentences verbatim " +
          "from the provided text).\n\nItems:\n" +
          JSON.stringify(itemsForPrompt, null, 2),
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return new Map();

  const parsed = JSON.parse(textBlock.text) as { results: { index: number; summary: string }[] };
  const map = new Map<number, string>();
  for (const r of parsed.results) {
    map.set(r.index, r.summary);
  }
  return map;
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
      model: MODEL,
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

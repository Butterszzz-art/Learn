import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "./claude";
import { getModel } from "./modelConfig";
import { cachedSystem } from "./promptCache";

const MAX_RESUME_ATTEMPTS = 3;

export interface RabbitHoleResult {
  title: string;
  summary: string;
  url: string;
  sourceName: string;
  topicArea: string;
}

// ---------------------------------------------------------------------------
// Phase 14 — same gather/write split as the other web-search-grounded
// generators: gatherRabbitHoleMaterial (Haiku, web_search, synchronous)
// finds one real item and its raw facts; writeRabbitHole (Haiku, no tools,
// batch-eligible) turns that into the actual inviting summary.
// generateRabbitHole composes both synchronously for callers needing an
// immediate result; the scheduled batch pipeline calls the gather step
// directly and queues buildRabbitHoleWriteParams through the Batches API.
// ---------------------------------------------------------------------------

const GATHER_SYSTEM_PROMPT =
  "You find one genuinely interesting, current item from OUTSIDE a reader's usual interests, for a " +
  "personal knowledge feed's 'Rabbit Hole of the Week' — the kind of thing that makes someone go 'huh, " +
  "I never think about this, but that's fascinating.' It must come from a real web search result with " +
  "a real, working URL — never invent a source. Gather the real facts; someone else writes the final " +
  "inviting summary from what you gather.";

export interface GatheredRabbitHoleMaterial {
  title: string;
  topicArea: string;
  sourceName: string;
  url: string;
  notes: string;
}

/**
 * Step 1 (synchronous, web_search): one item entirely outside the reader's
 * active interests, picked via web search, avoiding topics already shown
 * recently. Returns null on failure or if nothing suitable turns up.
 */
export async function gatherRabbitHoleMaterial(
  activeInterestNames: string[],
  avoidTopics: string[]
): Promise<GatheredRabbitHoleMaterial | null> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return null;

  const prompt =
    `The reader's active interests are: ${activeInterestNames.join(", ") || "(none yet)"}.\n\n` +
    "Use web search to find ONE genuinely interesting, current item from a field clearly OUTSIDE these " +
    "interests — something surprising, delightful, or thought-provoking that this reader would never " +
    "otherwise encounter. Avoid anything overlapping the interests listed above.\n\n" +
    (avoidTopics.length > 0
      ? `Don't repeat any of these topic areas already shown recently:\n${avoidTopics.map((t) => `- ${t}`).join("\n")}\n\n`
      : "") +
    "Respond in EXACTLY this format:\n\n" +
    "TITLE: <a concise, inviting title>\n" +
    "TOPIC_AREA: <the field this comes from, 2-4 words, e.g. 'Volcanology' or 'Competitive birdwatching'>\n" +
    "SOURCE: <the publication or outlet name>\n" +
    "URL: <the real URL you found via search>\n" +
    "NOTES: <the actual facts from the source, in enough detail for someone else to write a 3-4 " +
    "sentence inviting summary from — not the summary itself>";

  try {
    let messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
    let response = await anthropic.messages.create({
      model: getModel("gather"),
      max_tokens: 1024,
      system: cachedSystem(GATHER_SYSTEM_PROMPT),
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
      output_config: { effort: "medium" },
      messages,
    });

    let resumeAttempts = 0;
    while (response.stop_reason === "pause_turn" && resumeAttempts < MAX_RESUME_ATTEMPTS) {
      messages = [...messages, { role: "assistant", content: response.content }];
      response = await anthropic.messages.create({
        model: getModel("gather"),
        max_tokens: 1024,
        system: cachedSystem(GATHER_SYSTEM_PROMPT),
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
        output_config: { effort: "medium" },
        messages,
      });
      resumeAttempts++;
    }

    if (response.stop_reason === "refusal") {
      console.error("[rabbitHole] Claude refused to gather a rabbit hole.");
      return null;
    }

    const fullText = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n\n")
      .trim();

    const title = fullText.match(/^TITLE:\s*(.+)$/m)?.[1]?.trim();
    const topicArea = fullText.match(/^TOPIC_AREA:\s*(.+)$/m)?.[1]?.trim();
    const sourceName = fullText.match(/^SOURCE:\s*(.+)$/m)?.[1]?.trim();
    const url = fullText.match(/^URL:\s*(\S+)$/m)?.[1]?.trim();
    const notesMatch = fullText.match(/^NOTES:\s*([\s\S]*)$/m);
    const notes = notesMatch?.[1]?.trim();

    if (!title || !topicArea || !url || !notes || !/^https?:\/\//.test(url)) return null;
    return { title, topicArea, sourceName: sourceName || "Web search", url, notes };
  } catch (err) {
    console.error("[rabbitHole] Gathering failed:", err);
    return null;
  }
}

const WRITE_SYSTEM_PROMPT =
  "You write short, inviting summaries for a personal knowledge feed's Rabbit Hole of the Week, from " +
  "real, already-verified facts handed to you by a separate research step. Write in your own words — " +
  "never copy sentences verbatim from the notes.";

const WRITE_SCHEMA = {
  type: "object" as const,
  properties: {
    summary: {
      type: "string",
      description: "3-4 sentences in your own words, written to make someone curious to click through.",
    },
  },
  required: ["summary"],
  additionalProperties: false,
};

/**
 * Step 2 (no tools, batch-eligible): builds request params turning gathered
 * notes into the final inviting summary — shared by the synchronous path
 * (writeRabbitHole, below) and the Batches API path.
 */
export function buildRabbitHoleWriteParams(gathered: GatheredRabbitHoleMaterial): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: getModel("rabbit_hole_write"),
    max_tokens: 512,
    system: cachedSystem(WRITE_SYSTEM_PROMPT),
    output_config: { format: { type: "json_schema", schema: WRITE_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `Title: ${gathered.title}\nTopic area: ${gathered.topicArea}\nSource: ${gathered.sourceName}\n\nNotes:\n${gathered.notes}`,
      },
    ],
  };
}

export function parseRabbitHoleWriteResult(text: string): string {
  const parsed = JSON.parse(text) as { summary: string };
  return parsed.summary?.trim() ?? "";
}

async function writeRabbitHole(gathered: GatheredRabbitHoleMaterial): Promise<string | null> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return null;
  try {
    const response = await anthropic.messages.create(buildRabbitHoleWriteParams(gathered));
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    const summary = parseRabbitHoleWriteResult(textBlock.text);
    return summary || null;
  } catch (err) {
    console.error("[rabbitHole] Write step failed:", err);
    return null;
  }
}

/**
 * One item entirely outside the reader's active interests. Synchronous
 * gather-then-write composition, for callers needing an immediate result
 * (the manual "Refresh now" path). The scheduled batch pipeline calls
 * gatherRabbitHoleMaterial directly instead — see scripts/submitBatch.ts.
 */
export async function generateRabbitHole(activeInterestNames: string[], avoidTopics: string[]): Promise<RabbitHoleResult | null> {
  const gathered = await gatherRabbitHoleMaterial(activeInterestNames, avoidTopics);
  if (!gathered) return null;
  const summary = await writeRabbitHole(gathered);
  if (!summary) return null;
  return { title: gathered.title, summary, url: gathered.url, sourceName: gathered.sourceName, topicArea: gathered.topicArea };
}

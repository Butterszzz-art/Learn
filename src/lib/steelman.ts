import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "./claude";
import { getModel } from "./modelConfig";
import { cachedSystem } from "./promptCache";

const MAX_RESUME_ATTEMPTS = 3;

export interface SteelmanCandidate {
  index: number;
  title: string;
  summary: string;
}

export interface SteelmanResult {
  index: number;
  steelman: string;
}

// ---------------------------------------------------------------------------
// Phase 14 — same gather/write split as Deep Dive and Field News Roundup:
// gatherSteelmanMaterial (Haiku, web_search, synchronous) identifies which
// candidates genuinely qualify and researches the real counter-case for
// each; writeSteelmans (Sonnet, no tools, batch-eligible) turns that
// material into the actual counterargument prose. generateSteelmans
// composes both synchronously for callers needing an immediate result; the
// scheduled batch pipeline calls the gather step directly and queues
// buildSteelmanWriteParams through the Batches API (see
// scripts/processBatches.ts — steelman candidates come from News items, so
// this always runs as a round-b step, after round-a's News lands).
// ---------------------------------------------------------------------------

const GATHER_SYSTEM_PROMPT =
  "You research the strongest, most good-faith case against a piece's actual thesis, for a personal " +
  "knowledge feed's steelman companion — not a strawman or a hedge. Ground your research in real " +
  "material via web search. Someone else writes the final counterargument prose from what you gather.";

export interface GatheredSteelmanMaterial {
  index: number;
  title: string;
  material: string; // researched counter-case notes, not finished prose
}

/**
 * Step 1 (synchronous, web_search): given a batch of candidate news items
 * for one interest, identifies up to maxResults that present a genuine
 * arguable thesis and researches the real counter-case for each. Returns []
 * if none qualify or generation fails.
 */
export async function gatherSteelmanMaterial(
  interestName: string,
  candidates: SteelmanCandidate[],
  maxResults = 2
): Promise<GatheredSteelmanMaterial[]> {
  const anthropic = getAnthropicClient();
  if (!anthropic || candidates.length === 0) return [];

  const prompt =
    `Here are recent ${interestName} news items (numbered):\n\n` +
    candidates.map((c) => `${c.index}. ${c.title} — ${c.summary}`).join("\n") +
    `\n\nIdentify AT MOST ${maxResults} of these that present a genuine arguable thesis — an opinion piece, a ` +
    "policy argument, a contested interpretation. Skip purely descriptive/discovery items (a new " +
    "measurement, a new fossil, a factual event report) — those have no 'other side' to steelman. If " +
    "none qualify, that's fine — say so.\n\n" +
    "For each one that qualifies, use web search to research the actual thesis and gather the material " +
    "for the strongest good-faith counterargument to it — real points, evidence, and counter-considerations, " +
    "not the finished counterargument itself.\n\n" +
    "Respond with exactly one block per qualifying item, in this format, separated by a line containing " +
    "only three dashes (---):\n\n" +
    "ITEM: <the number>\n" +
    "MATERIAL: <the researched counter-case — points, evidence, counter-considerations>\n" +
    "---\n" +
    "ITEM: <next number>\n" +
    "...\n\n" +
    "If none of the items qualify, respond with exactly: NONE";

  try {
    let messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
    let response = await anthropic.messages.create({
      model: getModel("gather"),
      max_tokens: 3072,
      system: cachedSystem(GATHER_SYSTEM_PROMPT),
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
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
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
        output_config: { effort: "medium" },
        messages,
      });
      resumeAttempts++;
    }

    if (response.stop_reason === "refusal") {
      console.error(`[steelman] Claude refused to gather steelman material for "${interestName}".`);
      return [];
    }

    const fullText = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n\n")
      .trim();

    return parseGatherResponse(fullText, candidates, maxResults);
  } catch (err) {
    console.error(`[steelman] Gathering failed for "${interestName}":`, err);
    return [];
  }
}

function parseGatherResponse(
  fullText: string,
  candidates: SteelmanCandidate[],
  maxResults: number
): GatheredSteelmanMaterial[] {
  if (/^\s*NONE\s*$/i.test(fullText)) return [];
  const validIndexes = new Map(candidates.map((c) => [c.index, c.title]));
  const blocks = fullText.split(/\n-{3,}\n/);
  const results: GatheredSteelmanMaterial[] = [];

  for (const block of blocks) {
    const itemMatch = block.match(/^ITEM:\s*(\d+)/m);
    const materialMatch = block.match(/^MATERIAL:\s*([\s\S]*)$/m);
    if (!itemMatch || !materialMatch) continue;
    const index = Number(itemMatch[1]);
    const material = materialMatch[1].trim();
    const title = validIndexes.get(index);
    if (!title || !material) continue;
    results.push({ index, title, material });
  }
  return results.slice(0, maxResults);
}

const WRITE_SYSTEM_PROMPT =
  "You write steelman counterarguments for a personal knowledge feed — the strongest, most good-faith " +
  "case against a piece's actual thesis, from real research material handed to you by a separate " +
  "research step. Write in your own words, never copying sentences verbatim from the material.";

const WRITE_SCHEMA = {
  type: "object" as const,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          steelman: { type: "string", description: "2-4 sentences, in your own words, from the given material." },
        },
        required: ["index", "steelman"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

/**
 * Step 2 (no tools, batch-eligible): builds request params turning gathered
 * counter-case material into the finished steelman prose, one call for the
 * whole set — shared by the synchronous path (writeSteelmans, below) and
 * the Batches API path.
 */
export function buildSteelmanWriteParams(gathered: GatheredSteelmanMaterial[]): Anthropic.MessageCreateParamsNonStreaming {
  const itemsForPrompt = gathered.map((g) => ({ index: g.index, title: g.title, material: g.material }));
  return {
    model: getModel("steelman_write"),
    max_tokens: 2048,
    system: cachedSystem(WRITE_SYSTEM_PROMPT),
    output_config: { format: { type: "json_schema", schema: WRITE_SCHEMA } },
    messages: [{ role: "user", content: "Items:\n" + JSON.stringify(itemsForPrompt, null, 2) }],
  };
}

export function parseSteelmanWriteResult(text: string): SteelmanResult[] {
  const parsed = JSON.parse(text) as { results: { index: number; steelman: string }[] };
  return parsed.results.filter((r) => r.steelman?.trim()).map((r) => ({ index: r.index, steelman: r.steelman.trim() }));
}

async function writeSteelmans(gathered: GatheredSteelmanMaterial[]): Promise<SteelmanResult[]> {
  const anthropic = getAnthropicClient();
  if (!anthropic || gathered.length === 0) return [];
  try {
    const response = await anthropic.messages.create(buildSteelmanWriteParams(gathered));
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return [];
    return parseSteelmanWriteResult(textBlock.text);
  } catch (err) {
    console.error("[steelman] Write step failed:", err);
    return [];
  }
}

/**
 * Given a batch of candidate news items for one interest, uses web search to
 * identify up to maxResults that present a genuine arguable thesis and writes the
 * strongest good-faith counterargument to each. Synchronous gather-then-
 * write composition, for callers needing an immediate result (the manual
 * "Refresh now" path). The scheduled batch pipeline calls
 * gatherSteelmanMaterial directly instead — see scripts/processBatches.ts.
 */
export async function generateSteelmans(
  interestName: string,
  candidates: SteelmanCandidate[],
  maxResults = 2
): Promise<SteelmanResult[]> {
  const gathered = await gatherSteelmanMaterial(interestName, candidates, maxResults);
  if (gathered.length === 0) return [];
  return writeSteelmans(gathered);
}

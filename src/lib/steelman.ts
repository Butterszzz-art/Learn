import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "./claude";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
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

const SYSTEM_PROMPT =
  "You write steelman counterarguments for a personal knowledge feed — the strongest, most good-faith " +
  "case against a piece's actual thesis, not a strawman or a hedge. Ground your counterargument in real " +
  "material via web search where it strengthens the case. Write in your own words, never copying " +
  "sentences verbatim from any source.";

/**
 * Given a batch of candidate news items (title + summary) for one interest,
 * uses web search to identify up to 2 that present a genuine arguable
 * thesis (an opinion, a policy argument, a contested interpretation — not
 * purely descriptive discovery news), and writes the strongest good-faith
 * counterargument to each. One combined call per interest per cycle rather
 * than one per candidate, to bound API cost. Returns [] if none qualify.
 */
export async function generateSteelmans(
  interestName: string,
  candidates: SteelmanCandidate[]
): Promise<SteelmanResult[]> {
  const anthropic = getAnthropicClient();
  if (!anthropic || candidates.length === 0) return [];

  const prompt =
    `Here are recent ${interestName} news items (numbered):\n\n` +
    candidates.map((c) => `${c.index}. ${c.title} — ${c.summary}`).join("\n") +
    "\n\nIdentify AT MOST 2 of these that present a genuine arguable thesis — an opinion piece, a " +
    "policy argument, a contested interpretation. Skip purely descriptive/discovery items (a new " +
    "measurement, a new fossil, a factual event report) — those have no 'other side' to steelman. If " +
    "none qualify, that's fine — say so.\n\n" +
    "For each one that qualifies, use web search to research the actual thesis and write the strongest " +
    "good-faith counterargument to it, in your own words.\n\n" +
    "Respond with exactly one block per qualifying item, in this format, separated by a line containing " +
    "only three dashes (---):\n\n" +
    "ITEM: <the number>\n" +
    "STEELMAN: <the counterargument, 2-4 sentences>\n" +
    "---\n" +
    "ITEM: <next number>\n" +
    "...\n\n" +
    "If none of the items qualify, respond with exactly: NONE";

  try {
    let messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
    let response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
      output_config: { effort: "medium" },
      messages,
    });

    let resumeAttempts = 0;
    while (response.stop_reason === "pause_turn" && resumeAttempts < MAX_RESUME_ATTEMPTS) {
      messages = [...messages, { role: "assistant", content: response.content }];
      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
        output_config: { effort: "medium" },
        messages,
      });
      resumeAttempts++;
    }

    if (response.stop_reason === "refusal") {
      console.error(`[steelman] Claude refused to generate steelmans for "${interestName}".`);
      return [];
    }

    const fullText = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n\n")
      .trim();

    return parseSteelmanResponse(fullText, candidates);
  } catch (err) {
    console.error(`[steelman] Generation failed for "${interestName}":`, err);
    return [];
  }
}

function parseSteelmanResponse(fullText: string, candidates: SteelmanCandidate[]): SteelmanResult[] {
  if (/^\s*NONE\s*$/i.test(fullText)) return [];

  const validIndexes = new Set(candidates.map((c) => c.index));
  const blocks = fullText.split(/\n-{3,}\n/);
  const results: SteelmanResult[] = [];

  for (const block of blocks) {
    const itemMatch = block.match(/^ITEM:\s*(\d+)/m);
    const steelmanMatch = block.match(/^STEELMAN:\s*([\s\S]*)$/m);
    if (!itemMatch || !steelmanMatch) continue;

    const index = Number(itemMatch[1]);
    const steelman = steelmanMatch[1].trim();
    if (!validIndexes.has(index) || !steelman) continue;

    results.push({ index, steelman });
  }

  return results.slice(0, 2);
}

import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "./claude";
import type { RawItem } from "./types";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const MAX_RESUME_ATTEMPTS = 3;

const SYSTEM_PROMPT =
  "You research and report real, current, verifiable developments in a field, for a personal " +
  "knowledge feed. Every item must come from an actual web search result with a real, working URL — " +
  "never invent a source, a URL, or a detail. Summaries are written in your own words, never copied " +
  "verbatim from the source.";

function buildPrompt(interestName: string, focusOverride?: string): string {
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
    "SUMMARY: <2-3 sentences in your own words — never copy sentences verbatim from the source>\n" +
    "---\n" +
    "TITLE: <next item>\n" +
    "...\n\n" +
    "Only include items you actually found via search with a real, working URL. If you can only find " +
    "2 solid, verifiable items, that's fine — do not pad with weaker or fabricated items to reach 5."
  );
}

/**
 * Generates a "Field News Roundup" for an interest with no registered RSS
 * fetcher (any custom interest, Business/Political Science/Philosophy of
 * Science, or Critical Thinking & Argumentation) — 3-5 real, current,
 * web-search-grounded developments, each shaped like a RawItem so it can
 * flow through the same dedupe/score/render pipeline as fetched items.
 * focusOverride replaces the generic "developments in the field of X" ask
 * with a more specific one (see pipeline.ts's use for Critical Thinking).
 * Returns [] if no API key is configured or generation fails.
 */
export async function generateFieldNewsRoundup(interestName: string, focusOverride?: string): Promise<RawItem[]> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return [];

  try {
    let messages: Anthropic.MessageParam[] = [
      { role: "user", content: buildPrompt(interestName, focusOverride) },
    ];
    let response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3072,
      system: SYSTEM_PROMPT,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
      output_config: { effort: "medium" },
      messages,
    });

    let resumeAttempts = 0;
    while (response.stop_reason === "pause_turn" && resumeAttempts < MAX_RESUME_ATTEMPTS) {
      messages = [...messages, { role: "assistant", content: response.content }];
      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 3072,
        system: SYSTEM_PROMPT,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
        output_config: { effort: "medium" },
        messages,
      });
      resumeAttempts++;
    }

    if (response.stop_reason === "refusal") {
      console.error(`[newsRoundup] Claude refused to generate a roundup for "${interestName}".`);
      return [];
    }

    const fullText = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n\n")
      .trim();

    return parseRoundup(fullText).slice(0, 5);
  } catch (err) {
    console.error(`[newsRoundup] Generation failed for "${interestName}":`, err);
    return [];
  }
}

function parseRoundup(fullText: string): RawItem[] {
  const blocks = fullText.split(/\n-{3,}\n/);
  const items: RawItem[] = [];

  for (const block of blocks) {
    const title = block.match(/^TITLE:\s*(.+)$/m)?.[1]?.trim();
    const date = block.match(/^DATE:\s*(.+)$/m)?.[1]?.trim();
    const source = block.match(/^SOURCE:\s*(.+)$/m)?.[1]?.trim();
    const url = block.match(/^URL:\s*(\S+)$/m)?.[1]?.trim();
    const summaryMatch = block.match(/^SUMMARY:\s*([\s\S]*)$/m);
    const summary = summaryMatch?.[1]?.trim();

    if (!title || !url || !summary || !/^https?:\/\//.test(url)) continue;

    items.push({
      title,
      snippet: summary,
      url,
      publishedAt: normalizeDate(date),
      sourceName: source || "Web search",
      sourceType: "generated",
    });
  }

  return items;
}

function normalizeDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

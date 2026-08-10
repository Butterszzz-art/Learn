import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "./claude";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const MAX_RESUME_ATTEMPTS = 3;

export interface RabbitHoleResult {
  title: string;
  summary: string;
  url: string;
  sourceName: string;
  topicArea: string;
}

const SYSTEM_PROMPT =
  "You surface one genuinely interesting, current item from OUTSIDE a reader's usual interests, for a " +
  "personal knowledge feed's 'Rabbit Hole of the Day' — the kind of thing that makes someone go 'huh, " +
  "I never think about this, but that's fascinating.' It must come from a real web search result with " +
  "a real, working URL — never invent a source. Summarize in your own words, never copied verbatim.";

/**
 * One item entirely outside the reader's active interests — picked via web
 * search, avoiding topics already shown recently (avoidTopics). Returns
 * null on failure or if nothing suitable turns up.
 */
export async function generateRabbitHole(
  activeInterestNames: string[],
  avoidTopics: string[]
): Promise<RabbitHoleResult | null> {
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
    "SUMMARY: <3-4 sentences in your own words, written to make someone curious to click through>";

  try {
    let messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
    let response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
      output_config: { effort: "medium" },
      messages,
    });

    let resumeAttempts = 0;
    while (response.stop_reason === "pause_turn" && resumeAttempts < MAX_RESUME_ATTEMPTS) {
      messages = [...messages, { role: "assistant", content: response.content }];
      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
        output_config: { effort: "medium" },
        messages,
      });
      resumeAttempts++;
    }

    if (response.stop_reason === "refusal") {
      console.error("[rabbitHole] Claude refused to generate a rabbit hole.");
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
    const summary = fullText.match(/^SUMMARY:\s*([\s\S]*)$/m)?.[1]?.trim();

    if (!title || !topicArea || !url || !summary || !/^https?:\/\//.test(url)) return null;

    return { title, topicArea, sourceName: sourceName || "Web search", url, summary };
  } catch (err) {
    console.error("[rabbitHole] Generation failed:", err);
    return null;
  }
}

import type Anthropic from "@anthropic-ai/sdk";
import type { Level } from "@/db/schema";
import { getAnthropicClient } from "./claude";
import type { CoveredTopicsInfo } from "./interests";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const MAX_RESUME_ATTEMPTS = 3; // guards against pause_turn looping forever

export interface DeepDiveResult {
  topic: string;
  content: string; // markdown, "## Sources" section stripped out
  sources: { title: string; url: string }[];
}

const LEVEL_INSTRUCTIONS: Record<Level, string> = {
  new_to_this:
    "This reader is new to this field. Build from first principles with real rigor — define terms " +
    "as you introduce them, but do not oversimplify or write down to them. Assume general intelligence " +
    "and curiosity, just not prior exposure to this specific field's vocabulary or frameworks.",
  some_background:
    "This reader has some background in this field already — general familiarity, but not formal " +
    "study. Use standard terminology for the field without lengthy definitions, but still properly " +
    "ground any genuinely advanced or niche concepts you introduce.",
  advanced:
    "This reader is advanced — actively studying or working in this field. Skip introductory framing " +
    "entirely. Go straight into mechanisms, current open questions, and nuance that would only be " +
    "useful to someone who already has the basics down.",
  research_level:
    "This reader is at research level — either about to start research in this field or already doing " +
    "so. Write like a literature review aimed at that person, not a textbook chapter: engage directly " +
    "with actual open questions, current debates between competing views or approaches, and recent " +
    "papers or results. Assume full command of the field's standard toolkit and vocabulary.",
};

// Below research_level, there's deliberately no ceiling: the goal is that
// sustained daily use gradually carries the reader from their starting level
// toward genuinely advanced, research-adjacent territory over weeks/months,
// the way a real course sequence would — not an indefinite plateau at
// whatever level they started at.
function escalationInstruction(level: Level, totalCovered: number): string {
  if (level === "research_level" || totalCovered === 0) return "";
  return (
    `\nThis is entry #${totalCovered + 1} in the series. Each entry should be somewhat more ` +
    "sophisticated than the last as the series accumulates — use the length and content of the " +
    "topics-covered list below as your signal for how far the series has already progressed, and " +
    "push a bit further than the previous entry rather than holding steady at the reader's " +
    "originally-stated level. Over enough entries, the series should be capable of reaching genuinely " +
    "advanced, research-adjacent territory even if the reader started out new to the field — the " +
    "self-reported level sets the starting point, not a permanent ceiling."
  );
}

const SYSTEM_PROMPT =
  "You write entries in an ongoing explainer series that replaces doomscrolling with real, thorough " +
  "learning. The reader is a university student generally — write at that register regardless of the " +
  "specified level. Level never means writing more simply or condescendingly; it only changes which " +
  "concepts you can assume as background and how much terminology needs introducing versus can be " +
  "used directly. Ground the piece in real, current, citable material via web search rather than pure " +
  "recall — this is a knowledge feed, not a listicle, so favor genuine depth and structure over a " +
  "breezy summary.";

function buildUserPrompt(interestName: string, level: Level, covered: CoveredTopicsInfo): string {
  const coveredList =
    covered.recent.length > 0
      ? covered.recent.map((t) => `- ${t}`).join("\n")
      : "(none yet — this is the first entry in the series)";

  return (
    `Write the next entry in the ${interestName} explainer series.\n\n` +
    `Reader level: ${level}. ${LEVEL_INSTRUCTIONS[level]}${escalationInstruction(level, covered.totalCount)}\n\n` +
    `Topics already covered in this series, in the order they were covered — do not repeat any of ` +
    `them, and pick the next topic a well-designed course or syllabus would logically cover next ` +
    `(build on what's already been covered rather than jumping randomly or restarting from scratch, ` +
    `unless the list is empty, in which case start with a genuinely foundational topic):\n${coveredList}\n\n` +
    "Use web search to find real, current, citable material to ground this in — don't rely purely on " +
    "prior knowledge, especially for anything that could have moved on since your training.\n\n" +
    "Respond in EXACTLY this format (the TOPIC line must be the very first line):\n\n" +
    "TOPIC: <a concise topic name, 3-8 words>\n\n" +
    "<the full explainer, several hundred words, in markdown with clear ## section headings — genuinely " +
    "thorough, not a headline-and-blurb>\n\n" +
    "## Sources\n" +
    "- [Source title](https://real-url-you-actually-used)\n" +
    "- [Another source title](https://another-real-url)\n\n" +
    "List only real sources you actually used from web search results — never invent a source or URL."
  );
}

/**
 * Generates one deep dive for an interest: picks the next syllabus topic
 * given what's already been covered, researches it via the web_search tool,
 * and writes a level-calibrated long-form explainer with real sources.
 * Returns null if no API key is configured or generation fails — deep dives
 * are best-effort and should never block the rest of a refresh.
 */
export async function generateDeepDive(
  interestName: string,
  level: Level,
  covered: CoveredTopicsInfo
): Promise<DeepDiveResult | null> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return null;

  try {
    const userPrompt = buildUserPrompt(interestName, level, covered);
    let messages: Anthropic.MessageParam[] = [{ role: "user", content: userPrompt }];
    let response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
      output_config: { effort: "medium" },
      messages,
    });

    // Server-side web_search runs its own internal loop (up to 10 rounds);
    // if it hits that cap mid-research, resume rather than treating it as done.
    let resumeAttempts = 0;
    while (response.stop_reason === "pause_turn" && resumeAttempts < MAX_RESUME_ATTEMPTS) {
      messages = [...messages, { role: "assistant", content: response.content }];
      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
        output_config: { effort: "medium" },
        messages,
      });
      resumeAttempts++;
    }

    if (response.stop_reason === "refusal") {
      console.error(`[deepDive] Claude refused to generate a "${interestName}" deep dive.`);
      return null;
    }

    const fullText = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n\n")
      .trim();

    if (!fullText) return null;

    return parseDeepDiveResponse(fullText, response.content);
  } catch (err) {
    console.error(`[deepDive] Generation failed for "${interestName}":`, err);
    return null;
  }
}

function parseDeepDiveResponse(
  fullText: string,
  contentBlocks: Anthropic.ContentBlock[]
): DeepDiveResult {
  const topicMatch = fullText.match(/^TOPIC:\s*(.+)$/m);
  const topic = topicMatch?.[1]?.trim() || "Untitled topic";

  // Strip the TOPIC line from the body.
  let body = topicMatch ? fullText.replace(topicMatch[0], "").trim() : fullText;

  // Split off the "## Sources" section (case-insensitive, last occurrence —
  // the model was asked to put it at the very end).
  const sourcesHeadingMatch = body.match(/\n?##\s*Sources\s*\n([\s\S]*)$/i);
  let sources: { title: string; url: string }[] = [];
  if (sourcesHeadingMatch) {
    body = body.slice(0, sourcesHeadingMatch.index).trim();
    const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = linkRegex.exec(sourcesHeadingMatch[1])) !== null) {
      sources.push({ title: m[1].trim(), url: m[2].trim() });
    }
  }

  // Fallback: if the model didn't produce a parseable Sources section, pull
  // real URLs out of the web_search_tool_result blocks directly.
  if (sources.length === 0) {
    sources = harvestSourcesFromToolResults(contentBlocks).slice(0, 6);
  }

  return { topic, content: body, sources };
}

/**
 * Given a just-written deep dive, generates ONE short, concrete, actionable
 * "apply this to daily life" takeaway — or returns null if the topic
 * genuinely doesn't have a natural everyday application. Quality over
 * completeness per spec: a forced or generic insight is worse than none, so
 * the model is explicitly told to decline rather than pad.
 */
export async function generateAppliedInsight(
  interestName: string,
  deepDiveTopic: string,
  deepDiveContent: string
): Promise<string | null> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return null;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              applicable: {
                type: "boolean",
                description:
                  "True only if this specific topic has a genuine, concrete, actionable everyday " +
                  "application — not a stretch, not generic advice. False if it doesn't; many " +
                  "legitimate topics won't, and that's fine.",
              },
              content: {
                type: "string",
                description:
                  "2-4 sentences: a specific, concrete takeaway the reader could actually act on " +
                  "today, grounded in the deep dive's actual content. Empty string if applicable is false.",
              },
            },
            required: ["applicable", "content"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "user",
          content:
            `You just wrote this deep-dive explainer on "${deepDiveTopic}" for the ${interestName} ` +
            `series:\n\n---\n${deepDiveContent}\n---\n\n` +
            "If this specific topic has a genuine, concrete, actionable application to someone's " +
            "everyday life, write ONE short practical takeaway card grounded in what the deep dive " +
            "actually said — specific enough to act on today, not a vague platitude like 'be more " +
            "aware of this.' If it doesn't have a natural everyday application, say so — don't force " +
            "one just to have something. Quality over completeness.",
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    const parsed = JSON.parse(textBlock.text) as { applicable: boolean; content: string };
    if (!parsed.applicable || !parsed.content.trim()) return null;
    return parsed.content.trim();
  } catch (err) {
    console.error(`[deepDive] Applied insight generation failed for "${interestName}":`, err);
    return null;
  }
}

function harvestSourcesFromToolResults(
  blocks: Anthropic.ContentBlock[]
): { title: string; url: string }[] {
  const seen = new Set<string>();
  const results: { title: string; url: string }[] = [];
  for (const block of blocks) {
    if (block.type !== "web_search_tool_result") continue;
    const content = (block as any).content;
    if (!Array.isArray(content)) continue;
    for (const result of content) {
      const url = typeof result?.url === "string" ? result.url : null;
      const title = typeof result?.title === "string" ? result.title : url;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      results.push({ title: title || url, url });
    }
  }
  return results;
}

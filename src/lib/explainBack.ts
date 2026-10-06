import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "./claude";
import { getModel } from "./modelConfig";
import { cachedBlock, plainBlock } from "./promptCache";

// Phase 14 design note: explain-it-back feedback is Sonnet-tier (real
// judgment) and its input — the deep dive's full text — is cache_control'd
// so it can hit the same cache entry as that dive's grounded Drill/Applied
// Insight/Mental Model lens calls if they happen close together. It stays
// SYNCHRONOUS rather than routed through the Batches API, though: unlike
// every other batch-eligible call, this one is a live, in-the-moment user
// action (the reader submits their own-words explanation and is sitting
// there waiting for feedback) — it fails the "doesn't need an immediate
// response" test that makes something batch-eligible in the first place,
// and queuing it would be a real, unannounced UX regression (feedback
// showing up hours later), not a "just cheaper" change. Everything else
// about it (model tier, caching) still applies.

/**
 * Feedback on a reader's own-words explanation (or essay response) of a
 * deep dive — brief and specific, phrased supportively, never a grade or
 * score. Returns null on failure; the caller should surface that as a
 * simple error rather than retry silently, since this is a live user action.
 */
export async function generateExplainBackFeedback(
  deepDiveTopic: string,
  deepDiveContent: string,
  prompt: string,
  userExplanation: string
): Promise<string | null> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return null;

  try {
    const response = await anthropic.messages.create({
      model: getModel("explain_back_feedback"),
      max_tokens: 768,
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              feedback: {
                type: "string",
                description:
                  "Brief, specific feedback (3-5 sentences): what the explanation captured well, and " +
                  "what's missing or slightly off, if anything. Supportive in tone — this is retrieval " +
                  "practice, not a grade. Never assign a score, letter grade, or percentage.",
              },
            },
            required: ["feedback"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "user",
          content: [
            cachedBlock(`This is the original deep-dive explainer on "${deepDiveTopic}":\n\n---\n${deepDiveContent}\n---`),
            plainBlock(
              `The reader was asked: "${prompt}"\n\n` +
                `Their response:\n---\n${userExplanation}\n---\n\n` +
                "Give brief, specific feedback: what they captured well, and what's missing or slightly off " +
                "(if anything) compared to the original piece. Supportive, not a grade."
            ),
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    const parsed = JSON.parse(textBlock.text) as { feedback: string };
    return parsed.feedback?.trim() || null;
  } catch (err) {
    console.error(`[explainBack] Feedback generation failed for "${deepDiveTopic}":`, err);
    return null;
  }
}

const ESSAY_PROMPT_SCHEMA = {
  type: "object" as const,
  properties: {
    prompt: {
      type: "string",
      description:
        "One genuine open question inviting a short written response (a paragraph or two) — not a " +
        "factual recall question. Should be an honest open question in the field, not a trick or trivia.",
    },
  },
  required: ["prompt"],
  additionalProperties: false,
};

/** Builds the request params for an essay-prompt-question roll — batch-
 * eligible (light structured task, no live-response requirement — this is
 * generated ALONGSIDE a deep dive's write step, not in response to
 * something the reader is waiting on). Shared by the synchronous path
 * (generateEssayPrompt, below) and the Batches API path. */
export function buildEssayPromptParams(interestName: string, recentTopics: string[]): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: getModel("essay_prompt"),
    max_tokens: 512,
    output_config: { format: { type: "json_schema", schema: ESSAY_PROMPT_SCHEMA } },
    messages: [
      {
        role: "user",
        content:
          `Recent topics covered in the ${interestName} series:\n` +
          recentTopics.map((t) => `- ${t}`).join("\n") +
          "\n\nWrite one genuine open question drawn from these topics that invites a short written " +
          "response — a real question with room for a thoughtful, arguable answer, the kind an " +
          "instructor might pose for a short essay response. Not a recall/trivia question.",
      },
    ],
  };
}

export function parseEssayPromptResult(text: string): string | null {
  const parsed = JSON.parse(text) as { prompt: string };
  return parsed.prompt?.trim() || null;
}

/**
 * An essay-style open question drawn from an interest's recent covered
 * topics, for advanced/research_level interests occasionally (~weekly —
 * see the caller's dice roll) instead of the default "explain this back"
 * prompt. Returns null on failure or if nothing suitable comes to mind.
 */
export async function generateEssayPrompt(interestName: string, recentTopics: string[]): Promise<string | null> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return null;
  if (recentTopics.length === 0) return null;

  try {
    const response = await anthropic.messages.create(buildEssayPromptParams(interestName, recentTopics));
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    return parseEssayPromptResult(textBlock.text);
  } catch (err) {
    console.error(`[explainBack] Essay prompt generation failed for "${interestName}":`, err);
    return null;
  }
}

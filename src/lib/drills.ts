import { getAnthropicClient } from "./claude";
import { DRILL_TYPES } from "@/db/schema";
import type { DrillType } from "@/db/schema";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

export interface DrillGenResult {
  drillType: DrillType;
  conceptLabel: string;
  promptContent: string;
  options: string[]; // exactly 4
  correctOption: number; // 0-3
  explanation: string;
}

const DRILL_SCHEMA = {
  type: "object" as const,
  properties: {
    drillType: {
      type: "string",
      enum: [...DRILL_TYPES],
      description:
        "spot_fallacy: present an argument with a reasoning flaw, ask which fallacy it commits. " +
        "reconstruct_argument: ask the reader to identify the argument's correct logical structure or " +
        "conclusion. validity_check: present a syllogism-like structure, ask whether it's valid. " +
        "strengthen_weaken: ask which option would most strengthen or weaken the argument.",
    },
    conceptLabel: {
      type: "string",
      description:
        "A short label for the fallacy/logic-form/argument-pattern being practiced, e.g. 'Hasty " +
        "generalization' or 'Affirming the consequent' — used to track what's been drilled so it isn't " +
        "repeated.",
    },
    promptContent: {
      type: "string",
      description: "The argument, scenario, or question text shown to the reader, 2-5 sentences.",
    },
    options: {
      type: "array",
      items: { type: "string" },
      minItems: 4,
      maxItems: 4,
      description: "Exactly 4 answer options, one of which is correct.",
    },
    correctOption: { type: "integer", description: "0-based index of the correct option." },
    explanation: { type: "string", description: "One to two sentences on why the correct answer is correct." },
  },
  required: ["drillType", "conceptLabel", "promptContent", "options", "correctOption", "explanation"],
  additionalProperties: false,
};

function parseDrillResponse(text: string): DrillGenResult | null {
  const parsed = JSON.parse(text) as Partial<DrillGenResult> & { applicable?: boolean };
  if (parsed.applicable === false) return null;
  if (
    !parsed.drillType ||
    !(DRILL_TYPES as readonly string[]).includes(parsed.drillType) ||
    !parsed.conceptLabel?.trim() ||
    !parsed.promptContent?.trim() ||
    !Array.isArray(parsed.options) ||
    parsed.options.length !== 4 ||
    typeof parsed.correctOption !== "number" ||
    parsed.correctOption < 0 ||
    parsed.correctOption > 3 ||
    !parsed.explanation?.trim()
  ) {
    return null;
  }
  return parsed as DrillGenResult;
}

/**
 * Grounded drill: given a just-written deep dive, attempts to extract a
 * real argument, claim, or reasoning chain from it and build one
 * multiple-choice critical-thinking drill from it. Declines (returns null)
 * rather than forcing one when the piece is purely descriptive/factual with
 * nothing to interrogate — quality over completeness, same as Applied
 * Insights and follow-up topics.
 */
export async function generateGroundedDrill(
  interestName: string,
  deepDiveTopic: string,
  deepDiveContent: string
): Promise<DrillGenResult | null> {
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
                  "True only if this piece contains a genuine argument, claim, or chain of reasoning " +
                  "that can be turned into a real critical-thinking drill — not a stretch. False if " +
                  "it's purely descriptive/factual with nothing to interrogate; that's fine, many " +
                  "legitimate topics won't have one.",
              },
              ...DRILL_SCHEMA.properties,
            },
            required: ["applicable"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "user",
          content:
            `This is a deep-dive explainer on "${deepDiveTopic}" from the ${interestName} series:\n\n` +
            `---\n${deepDiveContent}\n---\n\n` +
            "If it contains a genuine argument, claim, or chain of reasoning, build ONE multiple-choice " +
            "critical-thinking drill grounded in that actual content — quote or closely paraphrase the " +
            "real argument, don't invent an unrelated logic puzzle. Pick whichever drill type fits the " +
            "material best. If the piece is purely descriptive or factual with no real argument to " +
            "interrogate, set applicable to false rather than forcing one.",
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    return parseDrillResponse(textBlock.text);
  } catch (err) {
    console.error(`[drills] Grounded drill generation failed for "${interestName}" / "${deepDiveTopic}":`, err);
    return null;
  }
}

/**
 * Standalone formal-logic drill: not tied to any specific deep dive — tests
 * syllogisms, validity vs. soundness, or a formal (structural) fallacy.
 * avoidConcepts lists recently-drilled/covered concept labels (pooled from
 * both Critical Thinking & Argumentation and Logic, since they share drill
 * material) so it doesn't repeat itself.
 */
export async function generateStandaloneLogicDrill(avoidConcepts: string[]): Promise<DrillGenResult | null> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return null;

  const avoidList = avoidConcepts.length > 0 ? avoidConcepts.map((c) => `- ${c}`).join("\n") : "(none yet)";

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: DRILL_SCHEMA.properties,
            required: DRILL_SCHEMA.required,
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "user",
          content:
            "Write ONE multiple-choice drill testing a formal logic concept — a syllogism, validity vs. " +
            "soundness, or a formal/structural fallacy (e.g. affirming the consequent, denying the " +
            "antecedent, undistributed middle). Self-contained, not tied to any specific news topic or " +
            `field.\n\nDon't repeat any of these concepts, already covered recently:\n${avoidList}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    return parseDrillResponse(textBlock.text);
  } catch (err) {
    console.error("[drills] Standalone logic drill generation failed:", err);
    return null;
  }
}

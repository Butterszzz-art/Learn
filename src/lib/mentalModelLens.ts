import { getAnthropicClient } from "./claude";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

export interface LensCandidateItem {
  index: number;
  title: string;
  summary: string;
  interestName: string;
}

export interface MentalModelLensResult {
  lensText: string;
  usedIndexes: number[]; // 1-2 of the candidate indexes it actually referenced
}

/**
 * Connects one mental model to today's actual feed items — 2-3 sentences
 * showing the model at work in one or two of them, ideally from different
 * interests so the connection doesn't feel like a coincidence. No web
 * search: this is pure reasoning over already-fetched content. Returns
 * null on failure or if the model doesn't cleanly apply to anything today
 * (declines rather than forcing a strained connection).
 */
export async function generateMentalModelLens(
  modelName: string,
  modelDescription: string,
  candidates: LensCandidateItem[]
): Promise<MentalModelLensResult | null> {
  const anthropic = getAnthropicClient();
  if (!anthropic || candidates.length === 0) return null;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 768,
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              applicable: {
                type: "boolean",
                description:
                  "True only if the model genuinely illuminates one or two of these items — not a " +
                  "stretch. False if nothing today fits naturally.",
              },
              usedIndexes: {
                type: "array",
                items: { type: "integer" },
                minItems: 1,
                maxItems: 2,
                description: "The index (or two) of the item(s) actually referenced, ideally from different interests.",
              },
              lensText: {
                type: "string",
                description:
                  "2-3 sentences showing the model applied concretely to the referenced item(s) — name " +
                  "the model, then connect it to what the item(s) actually say, not an abstract " +
                  "definition.",
              },
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
            `Mental model: "${modelName}" — ${modelDescription}\n\n` +
            "Today's feed items (numbered):\n" +
            candidates
              .map((c) => `${c.index}. [${c.interestName}] ${c.title} — ${c.summary}`)
              .join("\n") +
            "\n\nIf this model genuinely illuminates one or two of these items, write a 2-3 sentence " +
            "lens card connecting it to what they actually say — concrete, not an abstract restatement " +
            "of the model's definition. Prefer two items from different interests over one, if a " +
            "genuine connection exists across them. If nothing today fits naturally, set applicable to " +
            "false rather than forcing a strained connection.",
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    const parsed = JSON.parse(textBlock.text) as {
      applicable: boolean;
      usedIndexes?: number[];
      lensText?: string;
    };
    if (!parsed.applicable || !parsed.lensText?.trim() || !parsed.usedIndexes?.length) return null;

    const validIndexes = new Set(candidates.map((c) => c.index));
    const usedIndexes = parsed.usedIndexes.filter((i) => validIndexes.has(i)).slice(0, 2);
    if (usedIndexes.length === 0) return null;

    return { lensText: parsed.lensText.trim(), usedIndexes };
  } catch (err) {
    console.error(`[mentalModelLens] Generation failed for "${modelName}":`, err);
    return null;
  }
}

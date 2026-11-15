// Turns one long deep dive into everything the feed and the knowledge map
// need — short "bite" cards, the concepts it teaches (with prerequisites),
// quiz questions tied to those concepts, an optional apply-it takeaway, an
// optional myth-vs-fact, an optional diagram, and follow-up topics.
//
// One structured call on the fast model replaces what used to be three
// separate calls on the main model (follow-ups, self-check, insight).
import { client } from "@/db";
import type { Level } from "@/db/schema";
import { generateJson } from "../ai";
import { upsertCard, upsertConcept, addConceptEdge, baseDifficulty } from "./cards";
import type { BitePayload, QuizPayload, MythPayload, VisualPayload } from "../cardTypes";

interface Expansion {
  concepts: { name: string; definition: string; difficulty: number; prerequisites: string[] }[];
  bites: {
    headline: string;
    text: string;
    kind: "hook" | "idea" | "number" | "why";
    highlight: string;
    takeaway: string;
    conceptIndex: number;
  }[];
  quiz: { question: string; options: string[]; correctIndex: number; explanation: string; conceptIndex: number }[];
  followUps: { topic: string; teaser: string }[];
  insight: { applicable: boolean; content: string };
  myth: { applicable: boolean; myth: string; fact: string };
  diagram: { applicable: boolean; mermaid: string; caption: string };
}

const SCHEMA = {
  type: "object",
  properties: {
    concepts: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      description: "The distinct ideas this entry teaches. Each must be something a reader could be quizzed on.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short noun phrase, 1-5 words, e.g. 'Long-term potentiation'." },
          definition: { type: "string", description: "One or two plain sentences defining it." },
          difficulty: { type: "integer", description: "1 = introductory, 3 = undergraduate, 5 = research frontier." },
          prerequisites: {
            type: "array",
            items: { type: "string" },
            description:
              "Names of concepts that should be understood first. Use ONLY names from the existing-concepts " +
              "list or from earlier in this same concepts array. Empty if none.",
          },
        },
        required: ["name", "definition", "difficulty", "prerequisites"],
        additionalProperties: false,
      },
    },
    bites: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      description:
        "Short stand-alone cards for a swipe feed. Each must make sense with no other context and teach " +
        "exactly one thing. Order them so they build on each other.",
      items: {
        type: "object",
        properties: {
          headline: { type: "string", description: "A specific, curiosity-raising headline, max 9 words. No clickbait." },
          text: { type: "string", description: "40-90 words. Concrete and exact; keep real numbers and names." },
          kind: {
            type: "string",
            enum: ["hook", "idea", "number", "why"],
            description: "hook = a surprising opener; idea = one mechanism or concept; number = one striking figure; why = why it matters.",
          },
          highlight: { type: "string", description: "The single key term or number in the text to visually call out. Must appear verbatim in text." },
          takeaway: { type: "string", description: "One sentence the reader should remember, max 20 words." },
          conceptIndex: { type: "integer", description: "0-based index into concepts this bite teaches, or -1." },
        },
        required: ["headline", "text", "kind", "highlight", "takeaway", "conceptIndex"],
        additionalProperties: false,
      },
    },
    quiz: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      description: "Multiple-choice questions testing understanding (not trivia). At least one per concept where possible.",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
          correctIndex: { type: "integer", description: "0-3" },
          explanation: { type: "string", description: "One or two sentences on why the right answer is right." },
          conceptIndex: { type: "integer", description: "0-based index into concepts this question tests." },
        },
        required: ["question", "options", "correctIndex", "explanation", "conceptIndex"],
        additionalProperties: false,
      },
    },
    followUps: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          topic: { type: "string", description: "A concise 3-8 word follow-up subtopic this entry raised." },
          teaser: { type: "string", description: "One sentence on why it's worth reading next." },
        },
        required: ["topic", "teaser"],
        additionalProperties: false,
      },
    },
    insight: {
      type: "object",
      description: "A concrete thing the reader could do today because of this entry. applicable=false if there is no natural one — do not force it.",
      properties: { applicable: { type: "boolean" }, content: { type: "string", description: "2-4 sentences, or empty." } },
      required: ["applicable", "content"],
      additionalProperties: false,
    },
    myth: {
      type: "object",
      description: "A common misconception this entry corrects. applicable=false if the entry doesn't clearly correct one.",
      properties: {
        applicable: { type: "boolean" },
        myth: { type: "string", description: "The misconception, as people actually say it. One sentence." },
        fact: { type: "string", description: "What is actually true, 1-3 sentences." },
      },
      required: ["applicable", "myth", "fact"],
      additionalProperties: false,
    },
    diagram: {
      type: "object",
      description:
        "A small diagram ONLY if the entry describes a process, causal chain, hierarchy or comparison that a picture " +
        "genuinely clarifies. applicable=false otherwise.",
      properties: {
        applicable: { type: "boolean" },
        mermaid: {
          type: "string",
          description:
            "Mermaid 'flowchart TD' or 'flowchart LR' source, 4-9 nodes. Node ids are plain letters (A, B, C). " +
            'Put every label in double quotes inside brackets, e.g. A["Glutamate release"] --> B["NMDA receptor opens"]. ' +
            "No styling, no subgraphs, no special characters outside the quoted labels.",
        },
        caption: { type: "string", description: "One sentence saying what the diagram shows." },
      },
      required: ["applicable", "mermaid", "caption"],
      additionalProperties: false,
    },
  },
  required: ["concepts", "bites", "quiz", "followUps", "insight", "myth", "diagram"],
  additionalProperties: false,
} as const;

const SYSTEM =
  "You adapt long-form explainers for a learning app's swipe feed. Everything you write must be " +
  "faithful to the source entry: never add a fact, number or claim that is not in it. Write plainly " +
  "and precisely for a curious adult; never talk down, never hype.";

export interface ExpandInput {
  deepDiveId: number;
  interestId: number;
  interestName: string;
  level: Level;
  topic: string;
  content: string;
  generatesAppliedInsights: boolean;
}

/** Basic structural check so a malformed diagram never reaches a reader. */
export function looksLikeValidMermaid(src: string): boolean {
  const s = src.trim();
  if (!/^flowchart\s+(TD|LR|TB|RL)\b/.test(s)) return false;
  if (s.length > 1500 || !s.includes("-->")) return false;
  return (s.match(/"/g) ?? []).length % 2 === 0;
}

/**
 * Expands a deep dive into cards + concepts. Idempotent: every card has a
 * dedupe key derived from the deep dive id, so a retry adds nothing twice.
 * Returns the number of cards written, or null if generation failed.
 */
export async function expandDeepDive(input: ExpandInput): Promise<number | null> {
  const existingRes = await client.execute({
    sql: "SELECT name FROM concepts WHERE interest_id = ? AND owner_user_id IS NULL ORDER BY id DESC LIMIT 60",
    args: [input.interestId],
  });
  const existingNames = existingRes.rows.map((r: any) => r.name as string);

  const exp = await generateJson<Expansion>({
    tier: "fast",
    schema: SCHEMA as unknown as Record<string, unknown>,
    system: SYSTEM,
    maxTokens: 6000,
    prompt:
      `Field: ${input.interestName}\nReader level: ${input.level}\nEntry topic: "${input.topic}"\n\n` +
      `Concepts already in this field's knowledge map (reuse a name exactly if this entry teaches the same idea; ` +
      `use them as prerequisites where true):\n${existingNames.length ? existingNames.map((n) => `- ${n}`).join("\n") : "(none yet)"}\n\n` +
      `--- ENTRY ---\n${input.content}\n--- END ENTRY ---\n\n` +
      "Produce the feed adaptation of this entry.",
  });
  if (!exp || !Array.isArray(exp.bites) || exp.bites.length === 0) return null;

  // Concepts and their prerequisite edges.
  const conceptIds: number[] = [];
  const nameToId = new Map<string, number>();
  const allNamesRes = await client.execute({
    sql: "SELECT id, name FROM concepts WHERE interest_id = ? AND owner_user_id IS NULL",
    args: [input.interestId],
  });
  for (const r of allNamesRes.rows as any[]) nameToId.set(String(r.name).toLowerCase(), Number(r.id));

  for (const c of exp.concepts ?? []) {
    if (!c.name?.trim() || !c.definition?.trim()) {
      conceptIds.push(-1);
      continue;
    }
    const id = await upsertConcept({
      interestId: input.interestId,
      name: c.name,
      definition: c.definition,
      difficulty: c.difficulty || baseDifficulty(input.level),
      deepDiveId: input.deepDiveId,
    });
    conceptIds.push(id);
    nameToId.set(c.name.toLowerCase(), id);
    for (const pre of c.prerequisites ?? []) {
      const preId = nameToId.get(pre.toLowerCase());
      if (preId) await addConceptEdge(preId, id);
    }
  }
  const conceptAt = (i: number) => (i >= 0 && conceptIds[i] > 0 ? conceptIds[i] : null);
  const base = { interestId: input.interestId, level: input.level, deepDiveId: input.deepDiveId };
  let written = 0;
  let seq = 0;

  for (const [i, b] of exp.bites.entries()) {
    if (!b.headline?.trim() || !b.text?.trim()) continue;
    const payload: BitePayload = {
      kind: b.kind,
      highlight: b.highlight && b.text.includes(b.highlight) ? b.highlight : undefined,
      takeaway: b.takeaway?.trim() || undefined,
    };
    await upsertCard({
      ...base,
      type: "bite",
      conceptId: conceptAt(b.conceptIndex),
      seq: seq++,
      title: b.headline.trim(),
      body: b.text.trim(),
      payload: payload as unknown as Record<string, unknown>,
      dedupeKey: `dd${input.deepDiveId}:bite:${i}`,
    });
    written++;
  }

  if (exp.diagram?.applicable && looksLikeValidMermaid(exp.diagram.mermaid)) {
    const payload: VisualPayload = { mermaid: exp.diagram.mermaid.trim(), caption: exp.diagram.caption.trim() };
    await upsertCard({
      ...base,
      type: "visual",
      seq: seq++,
      title: input.topic,
      body: payload.caption,
      payload: payload as unknown as Record<string, unknown>,
      dedupeKey: `dd${input.deepDiveId}:visual`,
    });
    written++;
  }

  if (exp.myth?.applicable && exp.myth.myth?.trim() && exp.myth.fact?.trim()) {
    const payload: MythPayload = { myth: exp.myth.myth.trim(), fact: exp.myth.fact.trim() };
    await upsertCard({
      ...base,
      type: "myth",
      seq: seq++,
      title: payload.myth,
      body: payload.fact,
      payload: payload as unknown as Record<string, unknown>,
      dedupeKey: `dd${input.deepDiveId}:myth`,
    });
    written++;
  }

  const validQuiz = (exp.quiz ?? []).filter(
    (q) => q.question?.trim() && Array.isArray(q.options) && q.options.length === 4 && q.correctIndex >= 0 && q.correctIndex <= 3
  );
  for (const [i, q] of validQuiz.entries()) {
    const payload: QuizPayload = {
      options: q.options,
      correctIndex: q.correctIndex,
      explanation: q.explanation ?? "",
      kind: "selfcheck",
    };
    await upsertCard({
      ...base,
      type: "quiz",
      conceptId: conceptAt(q.conceptIndex) ?? conceptAt(0),
      seq: seq++,
      title: input.topic,
      body: q.question.trim(),
      payload: payload as unknown as Record<string, unknown>,
      dedupeKey: `dd${input.deepDiveId}:quiz:${i}`,
    });
    written++;
  }

  if (input.generatesAppliedInsights && exp.insight?.applicable && exp.insight.content?.trim()) {
    await upsertCard({
      ...base,
      type: "insight",
      seq: seq++,
      title: input.topic,
      body: exp.insight.content.trim(),
      dedupeKey: `dd${input.deepDiveId}:insight`,
    });
    written++;
  }

  const followUps = (exp.followUps ?? []).filter((f) => f.topic?.trim() && f.teaser?.trim());
  const selfCheck = validQuiz.map((q) => ({
    question: q.question,
    options: q.options,
    correctIndex: q.correctIndex,
    explanation: q.explanation,
  }));
  // Keep any follow-ups/self-check a pre-launch deep dive already had.
  await client.execute({
    sql: `UPDATE deep_dives SET
            follow_up_topics = CASE WHEN follow_up_topics IN ('', '[]') THEN ? ELSE follow_up_topics END,
            self_check_questions = CASE WHEN self_check_questions IN ('', '[]') THEN ? ELSE self_check_questions END,
            expanded_at = current_timestamp
          WHERE id = ?`,
    args: [JSON.stringify(followUps), JSON.stringify(selfCheck), input.deepDiveId],
  });
  return written;
}

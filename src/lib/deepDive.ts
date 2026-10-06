import type Anthropic from "@anthropic-ai/sdk";
import type { Level } from "@/db/schema";
import { getAnthropicClient } from "./claude";
import type { CoveredTopicsInfo } from "./interests";
import { getModel } from "./modelConfig";
import { cachedSystem, cachedBlock, plainBlock } from "./promptCache";
import { computeSyllabusComparison } from "./syllabus";
import type { SyllabusComparison, SyllabusTopicContext } from "./syllabus";

const MAX_RESUME_ATTEMPTS = 3; // guards against pause_turn looping forever

export interface DeepDiveResult {
  topic: string;
  content: string; // markdown, "## Sources" section stripped out
  sources: { title: string; url: string }[];
  // Phase 15 (Syllabus Awareness) — null when the interest has no attached
  // syllabus, or the chosen topic matches one with no dated reference to
  // compare against. See computeSyllabusComparison in syllabus.ts.
  syllabusComparison: SyllabusComparison | null;
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

// ---------------------------------------------------------------------------
// Phase 14 — the old single web_search-grounded call is split in two:
//   1. gatherDeepDiveMaterial: web_search-using, Haiku-tier, synchronous
//      (tool use isn't supported by the Batches API). Picks the topic and
//      collects real, citable notes + sources — NOT finished prose.
//   2. writeDeepDive: no tools, Sonnet-tier, batch-eligible. Turns the
//      gathered material into the actual long-form explainer.
// generateDeepDive (bottom of this file) composes the two synchronously,
// for callers that need an immediate result (on-demand curiosity branching/
// Binge/candidate-topic-pick, and the manual "Refresh now" path — see
// pipeline.ts). The scheduled batch pipeline instead calls
// gatherDeepDiveMaterial directly and queues buildDeepDiveWriteParams
// through the Batches API — see scripts/submitBatch.ts.
// ---------------------------------------------------------------------------

const GATHER_SYSTEM_PROMPT =
  "You research material for an ongoing explainer series that replaces doomscrolling with real, " +
  "thorough learning. Your job in this step is ONLY to pick the next topic and gather real, current, " +
  "citable material via web search — factual notes and sources, not finished prose. Someone else " +
  "writes the actual entry from what you gather, so be thorough and concrete: specific mechanisms, " +
  "findings, numbers, and open questions, not vague summary. Never invent a source or URL.";

export interface GatheredDeepDiveMaterial {
  topic: string;
  material: string; // research notes, not finished prose
  sources: { title: string; url: string }[];
}

/** Phase 15 (Syllabus Awareness): a nudge, not a hard rule — the point is
 * that Deep Dives lean toward genuine curriculum gaps over time, not that
 * every single one is guaranteed novel (continuity with the covered-topics
 * list above still matters, and sometimes the syllabus-adjacent topic really
 * is the right next one). What's actually provable per-entry is computed
 * separately after the fact — see computeSyllabusComparison in syllabus.ts —
 * so this prompt text doesn't need to be airtight, just a genuine steer. */
function syllabusGuidance(context: SyllabusTopicContext[]): string {
  if (context.length === 0) return "";
  const list = context
    .map((c) => `- ${c.topic} (${c.courseName}${c.reference ? ` — assigned: ${c.reference}` : ""})`)
    .join("\n");
  return (
    "\n\nThe reader's own course syllabus/syllabi for this subject already assign readings on some " +
    "topics — prefer picking a topic that ISN'T already covered below when a reasonable one is " +
    "available, so this series stays genuinely additive to their coursework rather than repeating it. " +
    "If continuity with what's already been covered above points squarely at one of these topics " +
    "anyway, that's fine — just don't default to it out of convenience.\n\n" +
    `Topics already assigned in the reader's course(s):\n${list}\n`
  );
}

function buildGatherPrompt(
  interestName: string,
  level: Level,
  covered: CoveredTopicsInfo,
  forcedTopic?: string,
  syllabusContext: SyllabusTopicContext[] = []
): string {
  const coveredList =
    covered.recent.length > 0
      ? covered.recent.map((t) => `- ${t}`).join("\n")
      : "(none yet — this is the first entry in the series)";

  const topicGuidance = forcedTopic
    ? `Research this exact topic: "${forcedTopic}". The reader chose this one directly (from a follow-up ` +
      `suggestion or a candidate list) — research exactly that, even if it seems to overlap with something ` +
      `covered before.\n\nFor context, topics already covered in this series:\n${coveredList}\n\n`
    : "Topics already covered in this series, in the order they were covered — do not repeat any of " +
      "them, and pick the next topic a well-designed course or syllabus would logically cover next " +
      "(build on what's already been covered rather than jumping randomly or restarting from scratch, " +
      `unless the list is empty, in which case start with a genuinely foundational topic):\n${coveredList}\n\n` +
      (forcedTopic ? "" : syllabusGuidance(syllabusContext));

  return (
    `Research the next entry in the ${interestName} explainer series.\n\n` +
    `Reader level: ${level}. ${LEVEL_INSTRUCTIONS[level]}\n\n` +
    topicGuidance +
    "Use web search to find real, current, citable material — don't rely purely on prior knowledge, " +
    "especially for anything that could have moved on since your training.\n\n" +
    "Respond in EXACTLY this format (the TOPIC line must be the very first line):\n\n" +
    "TOPIC: <a concise topic name, 3-8 words>\n\n" +
    "NOTES:\n" +
    "<thorough factual notes gathered from your research — specific mechanisms, findings, numbers, " +
    "current debates/open questions — enough material for someone else to write a genuinely thorough, " +
    "several-hundred-word explainer from. Not polished prose; a dense, well-organized brief is fine.>\n\n" +
    "## Sources\n" +
    "- [Source title](https://real-url-you-actually-used)\n" +
    "- [Another source title](https://another-real-url)\n\n" +
    "List only real sources you actually used from web search results — never invent a source or URL."
  );
}

/**
 * Step 1 (synchronous, web_search): picks the next syllabus topic given
 * what's already been covered, and researches it — real notes and sources,
 * not finished prose. Returns null if no API key is configured or gathering
 * fails.
 */
export async function gatherDeepDiveMaterial(
  interestName: string,
  level: Level,
  covered: CoveredTopicsInfo,
  forcedTopic?: string,
  syllabusContext: SyllabusTopicContext[] = []
): Promise<GatheredDeepDiveMaterial | null> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return null;

  try {
    const userPrompt = buildGatherPrompt(interestName, level, covered, forcedTopic, syllabusContext);
    let messages: Anthropic.MessageParam[] = [{ role: "user", content: userPrompt }];
    let response = await anthropic.messages.create({
      model: getModel("gather"),
      max_tokens: 2048,
      system: cachedSystem(GATHER_SYSTEM_PROMPT),
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
      output_config: { effort: "medium" },
      messages,
    });

    let resumeAttempts = 0;
    while (response.stop_reason === "pause_turn" && resumeAttempts < MAX_RESUME_ATTEMPTS) {
      messages = [...messages, { role: "assistant", content: response.content }];
      response = await anthropic.messages.create({
        model: getModel("gather"),
        max_tokens: 2048,
        system: cachedSystem(GATHER_SYSTEM_PROMPT),
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
        output_config: { effort: "medium" },
        messages,
      });
      resumeAttempts++;
    }

    if (response.stop_reason === "refusal") {
      console.error(`[deepDive] Claude refused to gather material for "${interestName}".`);
      return null;
    }

    const fullText = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n\n")
      .trim();
    if (!fullText) return null;

    const parsed = parseGatherResponse(fullText, response.content);
    if (forcedTopic) parsed.topic = forcedTopic;
    return parsed;
  } catch (err) {
    console.error(`[deepDive] Material gathering failed for "${interestName}":`, err);
    return null;
  }
}

function parseGatherResponse(fullText: string, contentBlocks: Anthropic.ContentBlock[]): GatheredDeepDiveMaterial {
  const topicMatch = fullText.match(/^TOPIC:\s*(.+)$/m);
  const topic = topicMatch?.[1]?.trim() || "Untitled topic";

  let rest = topicMatch ? fullText.slice((topicMatch.index ?? 0) + topicMatch[0].length).trim() : fullText;
  rest = rest.replace(/^NOTES:\s*/i, "");

  const sourcesHeadingMatch = rest.match(/\n?##\s*Sources\s*\n([\s\S]*)$/i);
  let material = rest;
  let sources: { title: string; url: string }[] = [];
  if (sourcesHeadingMatch) {
    material = rest.slice(0, sourcesHeadingMatch.index).trim();
    const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = linkRegex.exec(sourcesHeadingMatch[1])) !== null) {
      sources.push({ title: m[1].trim(), url: m[2].trim() });
    }
  }
  if (sources.length === 0) sources = harvestSourcesFromToolResults(contentBlocks).slice(0, 6);

  return { topic, material, sources };
}

const WRITE_SYSTEM_PROMPT =
  "You write entries in an ongoing explainer series that replaces doomscrolling with real, thorough " +
  "learning. The reader is a university student generally — write at that register regardless of the " +
  "specified level. Level never means writing more simply or condescendingly; it only changes which " +
  "concepts you can assume as background and how much terminology needs introducing versus can be " +
  "used directly. You're given real, current, already-researched material (gathered via web search by " +
  "a separate research step) to write from — ground the piece in it, don't invent facts beyond it, " +
  "though drawing on general background knowledge to explain or contextualize what's given is fine. " +
  "This is a knowledge feed, not a listicle: favor genuine depth and structure over a breezy summary.";

/**
 * Step 2 (no tools, batch-eligible): builds the exact request params for
 * turning gathered material into the finished explainer — shared by the
 * synchronous path (writeDeepDive, below) and the Batches API path (see
 * scripts/submitBatch.ts). Sources are never re-derived from this step's
 * output — they're already known good from the gather step, so the DB write
 * always uses those, not anything the model echoes back here.
 */
/** Phase 15 (Syllabus Awareness): when the chosen topic matches something
 * the reader's syllabus already assigned a dated reading for,
 * instruct the write step to actually address the gap directly rather than
 * just writing the normal explainer — e.g. "your syllabus cites a 2019
 * paper on this; here's what's changed since". `comparison` is computed
 * once, right after gathering, from real syllabus data (see
 * computeSyllabusComparison) — this only fires for "newer_than_assigned",
 * never "not_in_syllabus" (nothing to update the reader ON there).*/
function syllabusWriteInstruction(comparison: SyllabusComparison | null): string {
  if (!comparison || comparison.status !== "newer_than_assigned") return "";
  return (
    `\n\nOne more thing: the reader's ${comparison.courseName} syllabus assigns a reading on this exact ` +
    `topic from ${comparison.referenceYear}${comparison.reference ? ` (${comparison.reference})` : ""}. ` +
    "Include a short section (a couple sentences to a short paragraph is fine) explicitly addressing " +
    "what's changed, been revised, or been discovered since that reading — genuinely useful only if " +
    "there IS something to say; if the material gathered doesn't actually support a 'here's what's " +
    "new' claim, a brief note that the fundamentals from that reading still hold is fine too, but " +
    "don't fabricate a development that didn't happen."
  );
}

export function buildDeepDiveWriteParams(
  interestName: string,
  level: Level,
  covered: CoveredTopicsInfo,
  gathered: GatheredDeepDiveMaterial,
  syllabusComparison: SyllabusComparison | null = null
): Anthropic.MessageCreateParamsNonStreaming {
  const coveredList =
    covered.recent.length > 0
      ? covered.recent.map((t) => `- ${t}`).join("\n")
      : "(none yet — this is the first entry in the series)";

  const userPrompt =
    `Write the next entry in the ${interestName} explainer series on the topic: "${gathered.topic}".\n\n` +
    `Reader level: ${level}. ${LEVEL_INSTRUCTIONS[level]}${escalationInstruction(level, covered.totalCount)}\n\n` +
    `Topics already covered in this series, for continuity/tone (don't repeat them):\n${coveredList}` +
    syllabusWriteInstruction(syllabusComparison) +
    "\n\nWrite several hundred words, in markdown with clear ## section headings — genuinely thorough, " +
    "not a headline-and-blurb. Output ONLY the explainer body itself: no title line, no topic line, " +
    "and no Sources section (sources are tracked separately).\n\n" +
    "Researched material to write from:\n---\n" +
    gathered.material +
    "\n---";

  return {
    model: getModel("deep_dive_write"),
    max_tokens: 4096,
    system: cachedSystem(WRITE_SYSTEM_PROMPT),
    messages: [{ role: "user", content: userPrompt }],
  };
}

export function parseDeepDiveWriteResult(text: string): string {
  return text.trim();
}

async function writeDeepDive(
  interestName: string,
  level: Level,
  covered: CoveredTopicsInfo,
  gathered: GatheredDeepDiveMaterial,
  syllabusComparison: SyllabusComparison | null = null
): Promise<string | null> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return null;
  try {
    const response = await anthropic.messages.create(
      buildDeepDiveWriteParams(interestName, level, covered, gathered, syllabusComparison)
    );
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text" || !textBlock.text.trim()) return null;
    return parseDeepDiveWriteResult(textBlock.text);
  } catch (err) {
    console.error(`[deepDive] Write step failed for "${interestName}" / "${gathered.topic}":`, err);
    return null;
  }
}

/**
 * Synchronous convenience: gather then write, back to back, returning the
 * same shape the pre-Phase-14 single-call generateDeepDive returned. Used by
 * every caller that needs an immediate result — on-demand curiosity
 * branching/Binge/candidate-topic-pick, and the manual "Refresh now" path
 * (see pipeline.ts's generateAndPersistDeepDive). The scheduled batch
 * pipeline does NOT use this — it calls gatherDeepDiveMaterial directly and
 * queues the write step through the Batches API instead (see
 * scripts/submitBatch.ts), which is where Phase 14's actual cost savings
 * come from; this wrapper exists so those existing call sites are
 * unaffected by the split. Returns null if no API key is configured or
 * either step fails.
 */
export async function generateDeepDive(
  interestName: string,
  level: Level,
  covered: CoveredTopicsInfo,
  forcedTopic?: string,
  syllabusContext: SyllabusTopicContext[] = []
): Promise<DeepDiveResult | null> {
  const gathered = await gatherDeepDiveMaterial(interestName, level, covered, forcedTopic, syllabusContext);
  if (!gathered) return null;
  const syllabusComparison = forcedTopic ? null : computeSyllabusComparison(gathered.topic, syllabusContext);
  const content = await writeDeepDive(interestName, level, covered, gathered, syllabusComparison);
  if (!content) return null;
  return { topic: gathered.topic, content, sources: gathered.sources, syllabusComparison };
}

/**
 * Given a just-written deep dive, generates ONE short, concrete, actionable
 * "apply this to daily life" takeaway — or returns null if the topic
 * genuinely doesn't have a natural everyday application. Quality over
 * completeness per spec: a forced or generic insight is worse than none, so
 * the model is explicitly told to decline rather than pad.
 */
const APPLIED_INSIGHT_SCHEMA = {
  type: "object" as const,
  properties: {
    applicable: {
      type: "boolean",
      description:
        "True only if this specific topic has a genuine, concrete, actionable everyday application " +
        "— not a stretch, not generic advice. False if it doesn't; many legitimate topics won't, and " +
        "that's fine.",
    },
    content: {
      type: "string",
      description:
        "2-4 sentences: a specific, concrete takeaway the reader could actually act on today, grounded " +
        "in the deep dive's actual content. Empty string if applicable is false.",
    },
  },
  required: ["applicable", "content"],
  additionalProperties: false,
};

/** Builds request params for an Applied Insight attempt — shared by the
 * synchronous path (generateAppliedInsight, below) and the Batches API path
 * (Phase 14 — see scripts/processBatches.ts's round-b). The dive content is
 * cached so it can hit the same cache entry as that dive's grounded Drill/
 * Mental Model lens/follow-ups/self-check calls if processed close together. */
export function buildAppliedInsightParams(
  interestName: string,
  deepDiveTopic: string,
  deepDiveContent: string
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: getModel("applied_insight"),
    max_tokens: 1024,
    output_config: { format: { type: "json_schema", schema: APPLIED_INSIGHT_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          cachedBlock(`This is the deep-dive explainer on "${deepDiveTopic}" for the ${interestName} series:\n\n---\n${deepDiveContent}\n---`),
          plainBlock(
            "If this specific topic has a genuine, concrete, actionable application to someone's " +
              "everyday life, write ONE short practical takeaway card grounded in what the deep dive " +
              "actually said — specific enough to act on today, not a vague platitude like 'be more " +
              "aware of this.' If it doesn't have a natural everyday application, say so — don't force " +
              "one just to have something. Quality over completeness."
          ),
        ],
      },
    ],
  };
}

export function parseAppliedInsightResult(text: string): string | null {
  const parsed = JSON.parse(text) as { applicable: boolean; content: string };
  if (!parsed.applicable || !parsed.content?.trim()) return null;
  return parsed.content.trim();
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
    const response = await anthropic.messages.create(buildAppliedInsightParams(interestName, deepDiveTopic, deepDiveContent));
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    return parseAppliedInsightResult(textBlock.text);
  } catch (err) {
    console.error(`[deepDive] Applied insight generation failed for "${interestName}":`, err);
    return null;
  }
}

export interface FollowUpTopic {
  topic: string;
  teaser: string;
}

/**
 * Curiosity branching: given a just-written deep dive, proposes 2-3 natural
 * follow-up subtopics with a one-line teaser each — grounded in what THIS
 * specific entry raised (a mechanism, an open question, a related idea),
 * not just "whatever the syllabus would cover next" in general. No web
 * search needed — this is about framing the existing material, not
 * researching new material. Returns [] on failure; follow-ups are a nice-to-
 * have, never blocking.
 */
const FOLLOW_UP_SCHEMA = {
  type: "object" as const,
  properties: {
    followUps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string", description: "A concise 3-8 word natural follow-up subtopic." },
          teaser: {
            type: "string",
            description:
              "One sentence teasing why it's worth reading next, e.g. 'Next: how prospect theory " +
              "explains why losses loom larger than equivalent gains.'",
          },
        },
        required: ["topic", "teaser"],
        additionalProperties: false,
      },
      minItems: 2,
      maxItems: 3,
    },
  },
  required: ["followUps"],
  additionalProperties: false,
};

/** Builds request params for follow-up topics — shared by the synchronous
 * path (generateFollowUpTopics, below) and the Batches API path. */
export function buildFollowUpTopicsParams(
  interestName: string,
  deepDiveTopic: string,
  deepDiveContent: string
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: getModel("follow_up_topics"),
    max_tokens: 1024,
    output_config: { format: { type: "json_schema", schema: FOLLOW_UP_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          cachedBlock(`This is the deep-dive explainer on "${deepDiveTopic}" for the ${interestName} series:\n\n---\n${deepDiveContent}\n---`),
          plainBlock(
            "Propose 2-3 natural follow-up subtopics a curious reader would want to explore next, each " +
              "with a one-line teaser. Branch from what THIS entry specifically raised — a mechanism, an " +
              "open question, a related idea it touched on — not just the next generic syllabus topic."
          ),
        ],
      },
    ],
  };
}

export function parseFollowUpTopicsResult(text: string): FollowUpTopic[] {
  const parsed = JSON.parse(text) as { followUps: FollowUpTopic[] };
  return parsed.followUps.filter((f) => f.topic?.trim() && f.teaser?.trim());
}

/**
 * Curiosity branching: given a just-written deep dive, proposes 2-3 natural
 * follow-up subtopics with a one-line teaser each — grounded in what THIS
 * specific entry raised (a mechanism, an open question, a related idea),
 * not just "whatever the syllabus would cover next" in general. No web
 * search needed — this is about framing the existing material, not
 * researching new material. Returns [] on failure; follow-ups are a nice-to-
 * have, never blocking.
 */
export async function generateFollowUpTopics(
  interestName: string,
  deepDiveTopic: string,
  deepDiveContent: string
): Promise<FollowUpTopic[]> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return [];

  try {
    const response = await anthropic.messages.create(buildFollowUpTopicsParams(interestName, deepDiveTopic, deepDiveContent));
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return [];
    return parseFollowUpTopicsResult(textBlock.text);
  } catch (err) {
    console.error(`[deepDive] Follow-up topic generation failed for "${interestName}":`, err);
    return [];
  }
}

export interface SelfCheckQuestion {
  question: string;
  options: string[]; // exactly 4
  correctIndex: number; // 0-3
  explanation: string;
}

/**
 * Retrieval-practice self-check: 2-3 multiple-choice questions on a just-
 * written deep dive's core ideas. Purely for the reader's own recall — no
 * score is computed or stored anywhere, only the questions themselves.
 * Returns [] on failure; a self-check is a nice-to-have, never blocking.
 */
const SELF_CHECK_SCHEMA = {
  type: "object" as const,
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          options: {
            type: "array",
            items: { type: "string" },
            minItems: 4,
            maxItems: 4,
            description: "Exactly 4 options, one of which is correct.",
          },
          correctIndex: { type: "integer", description: "0-based index of the correct option." },
          explanation: { type: "string", description: "One line explaining why the correct answer is correct." },
        },
        required: ["question", "options", "correctIndex", "explanation"],
        additionalProperties: false,
      },
      minItems: 2,
      maxItems: 3,
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

/** Builds request params for retention self-check questions — shared by the
 * synchronous path (generateSelfCheckQuestions, below) and the Batches API path. */
export function buildSelfCheckParams(
  interestName: string,
  deepDiveTopic: string,
  deepDiveContent: string
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: getModel("self_check_questions"),
    max_tokens: 1536,
    output_config: { format: { type: "json_schema", schema: SELF_CHECK_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          cachedBlock(`This is the deep-dive explainer on "${deepDiveTopic}" for the ${interestName} series:\n\n---\n${deepDiveContent}\n---`),
          plainBlock(
            "Write 2-3 multiple-choice questions (4 options each, exactly one correct) testing the " +
              "entry's core ideas — genuine understanding, not trivia about a specific number or date " +
              "unless that number is actually central to the idea. Include a one-line explanation of why " +
              "the correct answer is correct, for after the reader picks."
          ),
        ],
      },
    ],
  };
}

export function parseSelfCheckResult(text: string): SelfCheckQuestion[] {
  const parsed = JSON.parse(text) as { questions: SelfCheckQuestion[] };
  return parsed.questions.filter(
    (q) => q.question?.trim() && Array.isArray(q.options) && q.options.length === 4 && q.correctIndex >= 0 && q.correctIndex <= 3
  );
}

/**
 * Retrieval-practice self-check: 2-3 multiple-choice questions on a just-
 * written deep dive's core ideas. Purely for the reader's own recall — no
 * score is computed or stored anywhere, only the questions themselves.
 * Returns [] on failure; a self-check is a nice-to-have, never blocking.
 */
export async function generateSelfCheckQuestions(
  interestName: string,
  deepDiveTopic: string,
  deepDiveContent: string
): Promise<SelfCheckQuestion[]> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return [];

  try {
    const response = await anthropic.messages.create(buildSelfCheckParams(interestName, deepDiveTopic, deepDiveContent));
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return [];
    return parseSelfCheckResult(textBlock.text);
  } catch (err) {
    console.error(`[deepDive] Self-check generation failed for "${interestName}":`, err);
    return [];
  }
}

/**
 * Passion Mode's "pick your next topic": 2-3 candidate next topics for an
 * interest's series, derived from the same syllabus-progression logic
 * generateDeepDive uses internally when picking automatically — surfaced
 * here instead so the reader can choose rather than the algorithm deciding.
 * No web search — this is about topic selection, not research. Returns []
 * on failure.
 */
export async function generateCandidateTopics(
  interestName: string,
  level: Level,
  covered: CoveredTopicsInfo
): Promise<FollowUpTopic[]> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return [];

  const coveredList =
    covered.recent.length > 0
      ? covered.recent.map((t) => `- ${t}`).join("\n")
      : "(none yet — this would be the first entry in the series)";

  try {
    const response = await anthropic.messages.create({
      model: getModel("candidate_topics"),
      max_tokens: 1024,
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              candidates: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    topic: { type: "string", description: "A concise 3-8 word candidate next topic." },
                    teaser: { type: "string", description: "One sentence on why it's worth reading next." },
                  },
                  required: ["topic", "teaser"],
                  additionalProperties: false,
                },
                minItems: 2,
                maxItems: 3,
              },
            },
            required: ["candidates"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "user",
          content:
            `For the ${interestName} explainer series (reader level: ${level}), topics already covered ` +
            `in order:\n${coveredList}\n\n` +
            "Propose 2-3 candidate next topics a well-designed syllabus could logically cover next, " +
            "each with a one-line teaser. Don't repeat anything already covered, and don't just pick " +
            "the single 'most obvious' one — give genuinely distinct options.",
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return [];
    const parsed = JSON.parse(textBlock.text) as { candidates: FollowUpTopic[] };
    return parsed.candidates.filter((c) => c.topic?.trim() && c.teaser?.trim());
  } catch (err) {
    console.error(`[deepDive] Candidate topic generation failed for "${interestName}":`, err);
    return [];
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

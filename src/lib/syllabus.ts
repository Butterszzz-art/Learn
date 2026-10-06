// ---------------------------------------------------------------------------
// Phase 15 — Syllabus Awareness ("Beyond Your Curriculum"). An interest can
// have multiple attached syllabi (multiple courses within one major); each
// is parsed once, at upload time, into a structured topic list — optionally
// with the specific reading/citation the course assigned and the year that
// reading was published, when the syllabus names one.
//
// That structured list feeds two things elsewhere:
//   1. deepDive.ts's gather step gets it as "topics to avoid repeating from
//      class" context, nudging topic selection toward genuine curriculum
//      gaps.
//   2. applySyllabusComparison (below) checks the topic Claude actually
//      picked against this list and computes a provable, per-entry tag —
//      "not in syllabus" or "newer than assigned reading" — rather than
//      trusting the model's own say-so. See deep_dives.syllabus_comparison
//      in schema.ts.
// ---------------------------------------------------------------------------
import { db } from "@/db";
import { syllabi, syllabusTopics } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { getAnthropicClient } from "./claude";
import { getModel } from "./modelConfig";

export interface ParsedSyllabusTopic {
  topic: string;
  reference: string | null;
  referenceYear: number | null;
}

const SYLLABUS_PARSE_SYSTEM_PROMPT =
  "You extract structured topic lists from course syllabi and reading lists for a personal learning " +
  "app. Read the pasted syllabus text and identify every distinct topic/subject it covers, in the " +
  "order presented. Where the syllabus assigns a specific reading for a topic (an author, a citation, " +
  "a 'Week N: ...' reading), capture that reading exactly as given — never invent one where the " +
  "syllabus just lists a bare topic name with no assigned reading.";

const SYLLABUS_PARSE_SCHEMA = {
  type: "object" as const,
  properties: {
    courseName: {
      type: "string",
      description:
        "The course code/title this syllabus is for, if identifiable from the text itself (e.g. " +
        "'PSYC301 - Cognitive Psychology'). Empty string if not identifiable.",
    },
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "A concise topic/subject name (roughly 3-8 words) this syllabus covers.",
          },
          reference: {
            type: "string",
            description:
              "The specific reading/citation the syllabus assigns for this topic, exactly as given — " +
              "e.g. 'Week 4: Baddeley (2000), Trends in Cognitive Sciences'. Empty string if the " +
              "syllabus just names the topic with no specific assigned reading.",
          },
        },
        required: ["topic", "reference"],
        additionalProperties: false,
      },
      description: "Every distinct topic this syllabus covers, in the order the syllabus presents them.",
    },
  },
  required: ["courseName", "topics"],
  additionalProperties: false,
};

/** Pulls the first plausible publication year (1900-2099) out of a
 * free-text reference string — "Week 4: Smith & Jones (2019)" -> 2019.
 * Never invents one; returns null if nothing looks like a year. */
function extractYear(reference: string): number | null {
  const match = reference.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

/**
 * Parses raw syllabus/reading-list text into a structured topic list via
 * the Anthropic API. Returns null (not []) on outright failure — the
 * caller should treat that as "couldn't parse this", distinct from a
 * successfully-parsed-but-empty syllabus (which shouldn't normally happen,
 * but isn't the same failure mode).
 */
export async function parseSyllabusContent(
  rawContent: string
): Promise<{ courseName: string; topics: ParsedSyllabusTopic[] } | null> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return null;

  try {
    const response = await anthropic.messages.create({
      model: getModel("syllabus_parse"),
      max_tokens: 4096,
      output_config: { format: { type: "json_schema", schema: SYLLABUS_PARSE_SCHEMA } },
      messages: [
        {
          role: "user",
          content: `Extract the topic list from this syllabus/reading list:\n\n---\n${rawContent.slice(0, 20000)}\n---`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    const parsed = JSON.parse(textBlock.text) as {
      courseName: string;
      topics: { topic: string; reference: string }[];
    };

    const topics = parsed.topics
      .filter((t) => t.topic?.trim())
      .map((t) => {
        const reference = t.reference?.trim() || null;
        return { topic: t.topic.trim(), reference, referenceYear: reference ? extractYear(reference) : null };
      });

    return { courseName: parsed.courseName?.trim() ?? "", topics };
  } catch (err) {
    console.error("[syllabus] Parsing failed:", err);
    return null;
  }
}

export interface SyllabusWithTopics {
  id: number;
  interestId: number;
  name: string;
  uploadedAt: string;
  topics: { id: number; topic: string; reference: string | null; referenceYear: number | null }[];
}

/**
 * Parses and persists a new syllabus for an interest. `name` is the
 * reader-supplied label (e.g. "PSYC301 - Cognitive Psychology"); if the
 * parse step identifies a clearer course name from the text itself and the
 * reader left the field blank, that's used instead. Throws if parsing
 * fails (no key configured, or the model call errors) — there's no
 * meaningful "syllabus with zero topics" to fall back to.
 */
export async function createSyllabus(interestId: number, name: string, rawContent: string): Promise<SyllabusWithTopics> {
  const trimmedContent = rawContent.trim();
  if (!trimmedContent) throw new Error("Syllabus content can't be empty");

  const parsed = await parseSyllabusContent(trimmedContent);
  if (!parsed || parsed.topics.length === 0) {
    throw new Error("Couldn't extract any topics from this syllabus — check the pasted text and try again.");
  }

  const finalName = name.trim() || parsed.courseName || "Untitled course";

  const inserted = await db
    .insert(syllabi)
    .values({ interestId, name: finalName, rawContent: trimmedContent })
    .returning({ id: syllabi.id, uploadedAt: syllabi.uploadedAt });
  const syllabusId = inserted[0].id;

  const topicRows = await db
    .insert(syllabusTopics)
    .values(
      parsed.topics.map((t) => ({
        syllabusId,
        topic: t.topic,
        reference: t.reference,
        referenceYear: t.referenceYear,
      }))
    )
    .returning();

  return {
    id: syllabusId,
    interestId,
    name: finalName,
    uploadedAt: inserted[0].uploadedAt,
    topics: topicRows.map((t) => ({ id: t.id, topic: t.topic, reference: t.reference, referenceYear: t.referenceYear })),
  };
}

/** Every syllabus attached to an interest, with its parsed topics, oldest
 * first — for Settings' per-interest syllabus manager. */
export async function getSyllabiForInterest(interestId: number): Promise<SyllabusWithTopics[]> {
  const syllabusRows = await db
    .select()
    .from(syllabi)
    .where(eq(syllabi.interestId, interestId))
    .orderBy(asc(syllabi.uploadedAt));
  if (syllabusRows.length === 0) return [];

  const out: SyllabusWithTopics[] = [];
  for (const s of syllabusRows) {
    const topicRows = await db
      .select()
      .from(syllabusTopics)
      .where(eq(syllabusTopics.syllabusId, s.id))
      .orderBy(asc(syllabusTopics.id));
    out.push({
      id: s.id,
      interestId: s.interestId,
      name: s.name,
      uploadedAt: s.uploadedAt,
      topics: topicRows.map((t) => ({ id: t.id, topic: t.topic, reference: t.reference, referenceYear: t.referenceYear })),
    });
  }
  return out;
}

export async function deleteSyllabus(id: number): Promise<void> {
  await db.delete(syllabusTopics).where(eq(syllabusTopics.syllabusId, id));
  await db.delete(syllabi).where(eq(syllabi.id, id));
}

export interface SyllabusTopicContext {
  topic: string;
  reference: string | null;
  referenceYear: number | null;
  courseName: string;
}

/** Every topic across every syllabus attached to an interest, flattened —
 * the shape deepDive.ts's gather step and applySyllabusComparison both
 * consume. Empty array (not an error) when the interest has no attached
 * syllabus, which callers treat as "nothing to compare against". */
export async function getSyllabusContext(interestId: number): Promise<SyllabusTopicContext[]> {
  const withTopics = await getSyllabiForInterest(interestId);
  return withTopics.flatMap((s) =>
    s.topics.map((t) => ({ topic: t.topic, reference: t.reference, referenceYear: t.referenceYear, courseName: s.name }))
  );
}

// ---------------------------------------------------------------------------
// Matching a freshly-chosen Deep Dive topic against a syllabus's topic list.
// Deliberately simple (substring + word-overlap), not semantic — the whole
// point is that the resulting tag is a provable, checkable fact ("this
// string doesn't appear anywhere in your syllabus"), not a model's own
// possibly-overconfident claim about curriculum coverage.
// ---------------------------------------------------------------------------

function significantWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4)
  );
}

function topicsLooselyMatch(a: string, b: string): boolean {
  const an = a.toLowerCase().trim();
  const bn = b.toLowerCase().trim();
  if (!an || !bn) return false;
  if (an.includes(bn) || bn.includes(an)) return true;
  const aw = significantWords(a);
  const bw = significantWords(b);
  if (aw.size === 0 || bw.size === 0) return false;
  let overlap = 0;
  for (const w of aw) if (bw.has(w)) overlap++;
  const union = new Set([...aw, ...bw]).size;
  return union > 0 && overlap / union >= 0.34;
}

export interface SyllabusComparison {
  status: "not_in_syllabus" | "newer_than_assigned";
  courseName: string;
  note: string;
  // Only set for "newer_than_assigned" — the syllabus's own reference
  // string and year, so deepDive.ts's write step can name what it's
  // updating the reader on rather than just gesturing at "changes since".
  reference: string | null;
  referenceYear: number | null;
}

/**
 * Compares a just-chosen Deep Dive topic against the interest's attached
 * syllabi and returns a provable, per-entry tag, or null when there's
 * nothing to attach (no syllabus attached at all, or the topic matches a
 * syllabus entry that has no dated reference to compare against — a plain
 * "this was on the syllabus" isn't itself a curriculum-gap claim). Called
 * once, right after a Deep Dive is written — see generateAndPersistDeepDive
 * in pipeline.ts.
 */
export function computeSyllabusComparison(diveTopic: string, context: SyllabusTopicContext[]): SyllabusComparison | null {
  if (context.length === 0) return null;

  const match = context.find((c) => topicsLooselyMatch(diveTopic, c.topic));
  if (!match) {
    const courseNames = [...new Set(context.map((c) => c.courseName))];
    const courseLabel = courseNames.length === 1 ? courseNames[0] : `${courseNames.length} attached syllabi`;
    return {
      status: "not_in_syllabus",
      courseName: courseLabel,
      note: `Not in your ${courseLabel} syllabus`,
      reference: null,
      referenceYear: null,
    };
  }

  if (match.referenceYear) {
    return {
      status: "newer_than_assigned",
      courseName: match.courseName,
      note: `Your ${match.courseName} syllabus cites a ${match.referenceYear} reading on this — this entry covers what's changed since`,
      reference: match.reference,
      referenceYear: match.referenceYear,
    };
  }

  return null; // on the syllabus, but no dated reference to claim "newer than"
}

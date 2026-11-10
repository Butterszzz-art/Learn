// The shared deep-dive series. Each (interest, level) pair has one ordered
// series that everyone at that level walks through, so an entry is
// researched and written once no matter how many people read it.
import { db, client } from "@/db";
import { deepDives } from "@/db/schema";
import type { Level } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { generateDeepDive } from "../deepDive";
import { generateGroundedDrill, generateStandaloneLogicDrill } from "../drills";
import { generateEssayPrompt } from "../explainBack";
import { getInterestRow, getSeriesTopics } from "../interests";
import type { InterestRow } from "../interests";
import { indexForSearch } from "../searchIndex";
import { DRILL_TYPE_LABELS } from "@/db/schema";
import { expandDeepDive } from "./expand";
import { checkDeepDiveQuality, applyQualityResult } from "./quality";
import { upsertCard, upsertConcept } from "./cards";
import type { QuizPayload } from "../cardTypes";

const ESSAY_PROMPT_CHANCE = 1 / 7;
const ESSAY_PROMPT_LEVELS: Level[] = ["advanced", "research_level"];
const DRILL_EVERY_N = 3; // one grounded critical-thinking drill per N deep dives

export interface SeriesResult {
  deepDiveId: number;
  topic: string;
  cards: number;
  flagged: boolean;
}

/** How many servable deep dives a series currently holds. */
export async function seriesDepth(interestId: number, level: Level): Promise<number> {
  const res = await client.execute({
    sql: "SELECT COUNT(*) AS n FROM deep_dives WHERE interest_id = ? AND level = ? AND status = 'published' AND origin = 'syllabus'",
    args: [interestId, level],
  });
  return Number((res.rows[0] as any)?.n ?? 0);
}

async function addDrillCard(interest: InterestRow, level: Level, deepDiveId: number, topic: string, content: string) {
  const drill = await generateGroundedDrill(interest.name, topic, content).catch(() => null);
  if (!drill) return;
  const conceptId = await upsertConcept({
    interestId: interest.id,
    name: drill.conceptLabel,
    definition: `${DRILL_TYPE_LABELS[drill.drillType]} — a reasoning pattern practiced on "${topic}".`,
    difficulty: 3,
    deepDiveId,
  });
  const payload: QuizPayload = {
    options: drill.options,
    correctIndex: drill.correctOption,
    explanation: drill.explanation,
    kind: "drill",
    drillLabel: DRILL_TYPE_LABELS[drill.drillType],
  };
  await upsertCard({
    type: "quiz",
    interestId: interest.id,
    level,
    conceptId,
    deepDiveId,
    seq: 50,
    title: topic,
    body: drill.promptContent,
    payload: payload as unknown as Record<string, unknown>,
    dedupeKey: `dd${deepDiveId}:drill`,
  });
}

async function writeAndPublish(
  interest: InterestRow,
  level: Level,
  opts: { forcedTopic?: string; origin: "syllabus" | "followup" }
): Promise<SeriesResult | null> {
  const covered = await getSeriesTopics(interest.id, level);
  const result = await generateDeepDive(interest.name, level, covered, opts.forcedTopic);
  if (!result) return null;

  const essayPrompt =
    ESSAY_PROMPT_LEVELS.includes(level) && Math.random() < ESSAY_PROMPT_CHANCE
      ? await generateEssayPrompt(interest.name, [...covered.recent, result.topic]).catch(() => null)
      : null;

  const seq = opts.origin === "syllabus" ? covered.totalCount + 1 : null;
  const inserted = await db
    .insert(deepDives)
    .values({
      interestId: interest.id,
      topic: result.topic,
      content: result.content,
      sources: JSON.stringify(result.sources),
      level,
      seq,
      origin: opts.origin,
      essayPrompt,
    })
    .returning({ id: deepDives.id });
  const deepDiveId = inserted[0].id;

  const [cards, quality] = await Promise.all([
    expandDeepDive({
      deepDiveId,
      interestId: interest.id,
      interestName: interest.name,
      level,
      topic: result.topic,
      content: result.content,
      generatesAppliedInsights: interest.generatesAppliedInsights,
    }).catch((err) => {
      console.error(`[series] expand failed for deep dive ${deepDiveId}:`, err);
      return null;
    }),
    checkDeepDiveQuality(result.topic, result.content, result.sources),
  ]);
  await applyQualityResult(deepDiveId, quality);

  if (!quality.flagged) {
    if (seq !== null && seq % DRILL_EVERY_N === 0) {
      await addDrillCard(interest, level, deepDiveId, result.topic, result.content);
    }
    await indexForSearch({
      contentType: "deep_dive",
      sourceId: deepDiveId,
      title: result.topic,
      body: result.content,
      interestLabel: interest.name,
      interestId: interest.id,
      date: new Date().toISOString(),
      url: `/deep-dive/${deepDiveId}`,
      userId: null,
    });
  }
  return { deepDiveId, topic: result.topic, cards: cards ?? 0, flagged: quality.flagged };
}

/** Writes the next entry in an (interest, level) series. */
export async function generateNextInSeries(interestId: number, level: Level): Promise<SeriesResult | null> {
  const interest = await getInterestRow(interestId);
  if (!interest || interest.isLibraryBook) return null;
  return writeAndPublish(interest, level, { origin: "syllabus" });
}

/**
 * A deep dive on a specific topic someone asked for (a follow-up card, or
 * "pick my next topic"). Reuses an existing entry on the same topic at the
 * same level if there is one — the second person to ask gets it instantly.
 */
export async function findOrGenerateTopicDive(interestId: number, level: Level, topic: string): Promise<SeriesResult | null> {
  const wanted = topic.trim();
  const existing = await client.execute({
    sql: "SELECT id, topic, status FROM deep_dives WHERE interest_id = ? AND level = ? AND lower(topic) = lower(?) LIMIT 1",
    args: [interestId, level, wanted],
  });
  const row = existing.rows[0] as any;
  if (row) return { deepDiveId: Number(row.id), topic: row.topic, cards: 0, flagged: row.status === "flagged" };

  const interest = await getInterestRow(interestId);
  if (!interest || interest.isLibraryBook) return null;
  return writeAndPublish(interest, level, { forcedTopic: wanted, origin: "followup" });
}

export async function findTopicDive(interestId: number, level: Level, topic: string): Promise<number | null> {
  const rows = await db
    .select({ id: deepDives.id, topic: deepDives.topic })
    .from(deepDives)
    .where(and(eq(deepDives.interestId, interestId), eq(deepDives.level, level)));
  const hit = rows.find((r) => r.topic.toLowerCase() === topic.trim().toLowerCase());
  return hit?.id ?? null;
}

/** Expands a deep dive that exists but has no cards yet (pre-launch content). */
export async function expandExistingDeepDive(deepDiveId: number): Promise<number | null> {
  const rows = await db.select().from(deepDives).where(eq(deepDives.id, deepDiveId)).limit(1);
  const dive = rows[0];
  if (!dive || dive.expandedAt) return 0;
  const interest = await getInterestRow(dive.interestId);
  if (!interest) return null;
  return expandDeepDive({
    deepDiveId,
    interestId: interest.id,
    interestName: interest.name,
    level: dive.level,
    topic: dive.topic,
    content: dive.content,
    generatesAppliedInsights: interest.generatesAppliedInsights,
  });
}

/** A stand-alone formal-logic drill for the Logic / Critical Thinking pools. */
export async function generateLogicDrill(interestId: number): Promise<boolean> {
  const recent = await client.execute({
    sql: "SELECT name FROM concepts WHERE interest_id = ? ORDER BY id DESC LIMIT 25",
    args: [interestId],
  });
  const drill = await generateStandaloneLogicDrill(recent.rows.map((r: any) => r.name as string)).catch(() => null);
  if (!drill) return false;
  const conceptId = await upsertConcept({
    interestId,
    name: drill.conceptLabel,
    definition: `${DRILL_TYPE_LABELS[drill.drillType]} practice.`,
    difficulty: 3,
  });
  const payload: QuizPayload = {
    options: drill.options,
    correctIndex: drill.correctOption,
    explanation: drill.explanation,
    kind: "drill",
    drillLabel: DRILL_TYPE_LABELS[drill.drillType],
  };
  await upsertCard({
    type: "quiz",
    interestId,
    level: null,
    conceptId,
    title: drill.conceptLabel,
    body: drill.promptContent,
    payload: payload as unknown as Record<string, unknown>,
    dedupeKey: `logic:${interestId}:${conceptId}:${Date.now()}`,
  });
  return true;
}

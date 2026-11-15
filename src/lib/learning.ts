// What each person knows (Phase 15). Every concept a person meets gets a
// row in user_concepts; graded answers (quiz cards, recall cards,
// explain-it-back) move it through FSRS spaced-repetition scheduling, which
// replaces the old fixed 3 → 7 → 21 → 60 day schedule. Mastery shown on the
// knowledge map is derived from that state, never stored separately.
import { fsrs, generatorParameters, createEmptyCard, Rating, State } from "ts-fsrs";
import type { Card as FsrsCard, Grade } from "ts-fsrs";
import { client } from "@/db";
import type { Mastery } from "./cardTypes";

// Long-term scheduling only: this is a feed, not a flashcard drill session,
// so there are no minute-scale learning steps — the first review is days out.
const scheduler = fsrs(generatorParameters({ enable_short_term: false, request_retention: 0.9, maximum_interval: 365 }));

export interface ConceptState {
  due: string | null;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: string | null;
  scheduledDays: number;
  learningSteps: number;
}

export const EMPTY_STATE: ConceptState = {
  due: null,
  stability: 0,
  difficulty: 0,
  reps: 0,
  lapses: 0,
  state: State.New,
  lastReview: null,
  scheduledDays: 0,
  learningSteps: 0,
};

export type Grade3 = "again" | "good" | "easy";

const GRADE_MAP: Record<Grade3, Grade> = { again: Rating.Again, good: Rating.Good, easy: Rating.Easy };

/** Pure: the next scheduling state after one graded answer. */
export function scheduleNext(prev: ConceptState, grade: Grade3, now: Date): ConceptState {
  const card: FsrsCard =
    prev.reps === 0 && prev.state === State.New
      ? createEmptyCard(now)
      : {
          due: prev.due ? new Date(prev.due) : now,
          stability: prev.stability,
          difficulty: prev.difficulty,
          elapsed_days: 0,
          scheduled_days: prev.scheduledDays,
          learning_steps: prev.learningSteps,
          reps: prev.reps,
          lapses: prev.lapses,
          state: prev.state as State,
          last_review: prev.lastReview ? new Date(prev.lastReview) : undefined,
        };
  const next = scheduler.next(card, now, GRADE_MAP[grade]).card;
  return {
    due: next.due.toISOString(),
    stability: next.stability,
    difficulty: next.difficulty,
    reps: next.reps,
    lapses: next.lapses,
    state: next.state,
    lastReview: now.toISOString(),
    scheduledDays: next.scheduled_days,
    learningSteps: next.learning_steps,
  };
}

/** Pure: mastery bucket for the knowledge map. */
export function masteryOf(s: { reps: number; state: number; stability: number } | null | undefined): Mastery {
  if (!s) return "unseen";
  if (s.reps === 0) return "seen";
  if (s.state !== State.Review || s.stability < 7) return "learning";
  return s.stability >= 30 ? "mastered" : "recalled";
}

/** Points toward the knowledge score for one concept. */
export const MASTERY_POINTS: Record<Mastery, number> = { unseen: 0, seen: 1, learning: 2, recalled: 4, mastered: 6 };

function rowToState(r: any): ConceptState {
  return {
    due: r.due ?? null,
    stability: Number(r.stability ?? 0),
    difficulty: Number(r.difficulty ?? 0),
    reps: Number(r.reps ?? 0),
    lapses: Number(r.lapses ?? 0),
    state: Number(r.state ?? 0),
    lastReview: r.last_review ?? null,
    scheduledDays: Number(r.scheduled_days ?? 0),
    learningSteps: Number(r.learning_steps ?? 0),
  };
}

/** Records that a person has met a concept. First recall check is due in 2 days. */
export async function markConceptSeen(userId: number, conceptId: number): Promise<void> {
  const now = new Date();
  await client.execute({
    sql: `INSERT OR IGNORE INTO user_concepts (user_id, concept_id, first_seen_at, due)
          VALUES (?, ?, ?, ?)`,
    args: [userId, conceptId, now.toISOString(), new Date(now.getTime() + 2 * 86400000).toISOString()],
  });
}

/** Applies one graded answer to a person's concept and reschedules it. */
export async function gradeConcept(userId: number, conceptId: number, grade: Grade3): Promise<ConceptState> {
  await markConceptSeen(userId, conceptId);
  const res = await client.execute({
    sql: "SELECT * FROM user_concepts WHERE user_id = ? AND concept_id = ?",
    args: [userId, conceptId],
  });
  const prev = rowToState(res.rows[0]);
  const next = scheduleNext(prev, grade, new Date());
  await client.execute({
    sql: `UPDATE user_concepts SET due = ?, stability = ?, difficulty = ?, reps = ?, lapses = ?, state = ?,
            last_review = ?, scheduled_days = ?, learning_steps = ?,
            correct_count = correct_count + ?, wrong_count = wrong_count + ?
          WHERE user_id = ? AND concept_id = ?`,
    args: [
      next.due,
      next.stability,
      next.difficulty,
      next.reps,
      next.lapses,
      next.state,
      next.lastReview,
      next.scheduledDays,
      next.learningSteps,
      grade === "again" ? 0 : 1,
      grade === "again" ? 1 : 0,
      userId,
      conceptId,
    ],
  });
  return next;
}

export interface DueConcept {
  conceptId: number;
  name: string;
  definition: string;
  interestId: number;
  interestName: string;
  deepDiveId: number | null;
  chapterId: number | null;
  reps: number;
}

/** Concepts whose review is due, most overdue first. */
export async function getDueConcepts(userId: number, limit = 20): Promise<DueConcept[]> {
  const res = await client.execute({
    sql: `SELECT c.id, c.name, c.definition, c.interest_id, i.name AS interest_name, c.deep_dive_id, c.chapter_id, uc.reps
          FROM user_concepts uc
          JOIN concepts c ON c.id = uc.concept_id
          JOIN interests i ON i.id = c.interest_id
          WHERE uc.user_id = ? AND uc.due IS NOT NULL AND uc.due <= ?
          ORDER BY uc.due ASC LIMIT ?`,
    args: [userId, new Date().toISOString(), limit],
  });
  return (res.rows as any[]).map((r) => ({
    conceptId: Number(r.id),
    name: r.name,
    definition: r.definition,
    interestId: Number(r.interest_id),
    interestName: r.interest_name,
    deepDiveId: r.deep_dive_id === null ? null : Number(r.deep_dive_id),
    chapterId: r.chapter_id === null ? null : Number(r.chapter_id),
    reps: Number(r.reps),
  }));
}

export async function countDue(userId: number): Promise<number> {
  const res = await client.execute({
    sql: "SELECT COUNT(*) AS n FROM user_concepts WHERE user_id = ? AND due IS NOT NULL AND due <= ?",
    args: [userId, new Date().toISOString()],
  });
  return Number((res.rows[0] as any)?.n ?? 0);
}

export interface MapConcept {
  id: number;
  name: string;
  definition: string;
  difficulty: number;
  deepDiveId: number | null;
  chapterId: number | null;
  mastery: Mastery;
  due: string | null;
  prereqs: number[];
}

export interface InterestKnowledge {
  interestId: number;
  interestName: string;
  concepts: MapConcept[];
  counts: Record<Mastery, number>;
  score: number;
}

/** The knowledge map: every concept in the person's interests with their mastery of it. */
export async function getKnowledgeMap(userId: number, interestIds: number[]): Promise<InterestKnowledge[]> {
  if (interestIds.length === 0) return [];
  const marks = interestIds.map(() => "?").join(",");
  const res = await client.execute({
    sql: `SELECT c.id, c.name, c.definition, c.difficulty, c.interest_id, c.deep_dive_id, c.chapter_id, i.name AS interest_name,
                 uc.reps, uc.state, uc.stability, uc.due, uc.user_id AS has_state
          FROM concepts c
          JOIN interests i ON i.id = c.interest_id
          LEFT JOIN user_concepts uc ON uc.concept_id = c.id AND uc.user_id = ?
          WHERE c.interest_id IN (${marks}) AND (c.owner_user_id IS NULL OR c.owner_user_id = ?)
          ORDER BY c.interest_id, c.difficulty, c.id`,
    args: [userId, ...interestIds, userId],
  });
  const ids = (res.rows as any[]).map((r) => Number(r.id));
  const prereqs = new Map<number, number[]>();
  if (ids.length > 0) {
    const edgeRes = await client.execute({
      sql: `SELECT e.from_concept_id, e.to_concept_id FROM concept_edges e
            JOIN concepts c ON c.id = e.to_concept_id
            WHERE c.interest_id IN (${marks}) AND e.kind = 'prereq'`,
      args: interestIds,
    });
    for (const e of edgeRes.rows as any[]) {
      const to = Number(e.to_concept_id);
      prereqs.set(to, [...(prereqs.get(to) ?? []), Number(e.from_concept_id)]);
    }
  }

  const byInterest = new Map<number, InterestKnowledge>();
  for (const r of res.rows as any[]) {
    const interestId = Number(r.interest_id);
    if (!byInterest.has(interestId)) {
      byInterest.set(interestId, {
        interestId,
        interestName: r.interest_name,
        concepts: [],
        counts: { unseen: 0, seen: 0, learning: 0, recalled: 0, mastered: 0 },
        score: 0,
      });
    }
    const k = byInterest.get(interestId)!;
    const mastery = masteryOf(
      r.has_state === null ? null : { reps: Number(r.reps), state: Number(r.state), stability: Number(r.stability) }
    );
    k.concepts.push({
      id: Number(r.id),
      name: r.name,
      definition: r.definition,
      difficulty: Number(r.difficulty),
      deepDiveId: r.deep_dive_id === null ? null : Number(r.deep_dive_id),
      chapterId: r.chapter_id === null ? null : Number(r.chapter_id),
      mastery,
      due: r.due ?? null,
      prereqs: prereqs.get(Number(r.id)) ?? [],
    });
    k.counts[mastery]++;
    k.score += MASTERY_POINTS[mastery];
  }
  return [...byInterest.values()];
}

export interface KnowledgeSummary {
  score: number;
  conceptsMet: number;
  conceptsSolid: number; // recalled or mastered
  learnedThisWeek: number;
  cardsThisWeek: number;
  cardsToday: number;
  quizAccuracy: number | null; // last 30 days, 0-1
}

export async function getKnowledgeSummary(userId: number): Promise<KnowledgeSummary> {
  const res = await client.execute({
    sql: "SELECT reps, state, stability, first_seen_at FROM user_concepts WHERE user_id = ?",
    args: [userId],
  });
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  let score = 0;
  let solid = 0;
  let learnedThisWeek = 0;
  for (const r of res.rows as any[]) {
    const m = masteryOf({ reps: Number(r.reps), state: Number(r.state), stability: Number(r.stability) });
    score += MASTERY_POINTS[m];
    if (m === "recalled" || m === "mastered") solid++;
    if (r.first_seen_at >= weekAgo) learnedThisWeek++;
  }
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const cardsRes = await client.execute({
    sql: `SELECT
            SUM(CASE WHEN seen_at >= ? THEN 1 ELSE 0 END) AS week,
            SUM(CASE WHEN seen_at >= ? THEN 1 ELSE 0 END) AS today,
            SUM(CASE WHEN answered_correct = 1 AND seen_at >= ? THEN 1 ELSE 0 END) AS correct,
            SUM(CASE WHEN answered_correct IS NOT NULL AND seen_at >= ? THEN 1 ELSE 0 END) AS answered
          FROM user_cards WHERE user_id = ?`,
    args: [weekAgo, dayStart.toISOString(), new Date(Date.now() - 30 * 86400000).toISOString(), new Date(Date.now() - 30 * 86400000).toISOString(), userId],
  });
  const c = cardsRes.rows[0] as any;
  const answered = Number(c?.answered ?? 0);
  return {
    score,
    conceptsMet: res.rows.length,
    conceptsSolid: solid,
    learnedThisWeek,
    cardsThisWeek: Number(c?.week ?? 0),
    cardsToday: Number(c?.today ?? 0),
    quizAccuracy: answered > 0 ? Number(c?.correct ?? 0) / answered : null,
  };
}

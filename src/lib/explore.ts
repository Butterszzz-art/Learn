// Read models for the Explore, Review and Me tabs.
import { client } from "@/db";
import type { Level } from "@/db/schema";
import type { InterestWithConfig } from "./interests";
import type { FeedCard } from "./cardTypes";

export interface PathEntry {
  deepDiveId: number;
  topic: string;
  seen: boolean;
}

export interface LearningPath {
  interestId: number;
  interestName: string;
  level: Level;
  entries: PathEntry[];
  done: number;
}

/**
 * Learning paths: each followed interest's series at the reader's level,
 * in order, with what they've already met. The path is the shared
 * syllabus, so progress here is real progress through a course sequence.
 */
export async function getLearningPaths(userId: number, interests: InterestWithConfig[]): Promise<LearningPath[]> {
  const out: LearningPath[] = [];
  for (const i of interests) {
    const res = await client.execute({
      sql: `SELECT d.id, d.topic,
                   EXISTS (SELECT 1 FROM user_cards uc JOIN cards c ON c.id = uc.card_id
                           WHERE uc.user_id = ? AND c.deep_dive_id = d.id) AS seen
            FROM deep_dives d
            WHERE d.interest_id = ? AND d.level = ? AND d.status = 'published' AND d.origin = 'syllabus'
            ORDER BY d.seq, d.id`,
      args: [userId, i.id, i.level],
    });
    const entries = (res.rows as any[]).map((r) => ({ deepDiveId: Number(r.id), topic: r.topic as string, seen: !!r.seen }));
    out.push({ interestId: i.id, interestName: i.name, level: i.level, entries, done: entries.filter((e) => e.seen).length });
  }
  return out;
}

export interface TrendingConcept {
  conceptId: number;
  name: string;
  interestName: string;
  deepDiveId: number | null;
  learners: number;
}

/** Concepts the most people met this week. Counts only — never who. */
export async function getTrendingConcepts(limit = 8): Promise<TrendingConcept[]> {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const res = await client.execute({
    sql: `SELECT c.id, c.name, c.deep_dive_id, i.name AS interest_name, COUNT(DISTINCT uc.user_id) AS learners
          FROM user_concepts uc
          JOIN concepts c ON c.id = uc.concept_id
          JOIN interests i ON i.id = c.interest_id
          WHERE uc.first_seen_at >= ? AND c.owner_user_id IS NULL AND i.is_library_book = 0
          GROUP BY c.id ORDER BY learners DESC, c.id DESC LIMIT ?`,
    args: [weekAgo, limit],
  });
  return (res.rows as any[]).map((r) => ({
    conceptId: Number(r.id),
    name: r.name,
    interestName: r.interest_name,
    deepDiveId: r.deep_dive_id === null ? null : Number(r.deep_dive_id),
    learners: Number(r.learners),
  }));
}

/** Quiz cards from entries the reader has met but not yet answered — extra practice. */
export async function getPracticeCards(userId: number, limit = 10): Promise<FeedCard[]> {
  const res = await client.execute({
    sql: `SELECT c.id, c.title, c.body, c.payload, c.interest_id, c.concept_id, c.deep_dive_id, c.level,
                 i.name AS interest_name, k.name AS concept_name
          FROM cards c
          LEFT JOIN interests i ON i.id = c.interest_id
          LEFT JOIN concepts k ON k.id = c.concept_id
          WHERE c.type = 'quiz' AND c.status = 'published'
            AND NOT EXISTS (SELECT 1 FROM user_cards uc WHERE uc.user_id = ? AND uc.card_id = c.id AND uc.answered_correct IS NOT NULL)
            AND (c.deep_dive_id IN (SELECT c2.deep_dive_id FROM user_cards uc2 JOIN cards c2 ON c2.id = uc2.card_id
                                    WHERE uc2.user_id = ? AND c2.deep_dive_id IS NOT NULL)
                 OR (c.deep_dive_id IS NULL AND c.interest_id IN (SELECT interest_id FROM user_interest_prefs WHERE user_id = ? AND enabled = 1)))
          ORDER BY RANDOM() LIMIT ?`,
    args: [userId, userId, userId, limit],
  });
  return (res.rows as any[]).map((r) => {
    let payload: Record<string, any> = {};
    try {
      payload = JSON.parse(r.payload);
    } catch {}
    return {
      key: `c${r.id}`,
      kind: "quiz" as const,
      cardId: Number(r.id),
      interestId: r.interest_id === null ? null : Number(r.interest_id),
      interestName: r.interest_name ?? null,
      level: r.level ?? null,
      title: r.title,
      body: r.body,
      payload,
      conceptId: r.concept_id === null ? null : Number(r.concept_id),
      conceptName: r.concept_name ?? null,
      deepDiveId: r.deep_dive_id === null ? null : Number(r.deep_dive_id),
      deepDiveTopic: null,
      explore: false,
      saved: false,
      aiGenerated: true,
    };
  });
}

/**
 * Days-in-a-row count for people who opted in. Forgiving by design: one
 * missed day in any seven doesn't break it.
 */
export function computeStreak(activeDays: string[], today: string): number {
  const days = new Set(activeDays);
  const d = new Date(today + "T00:00:00Z");
  // Not having opened the app yet today doesn't count as a miss.
  if (!days.has(today)) d.setUTCDate(d.getUTCDate() - 1);
  let streak = 0;
  const recentMisses: number[] = []; // positions (days back) of forgiven misses
  for (let back = 0; back < 400; back++) {
    const key = d.toISOString().slice(0, 10);
    if (days.has(key)) {
      streak++;
    } else {
      const missesInWindow = recentMisses.filter((m) => back - m < 7).length;
      if (missesInWindow >= 1) break;
      recentMisses.push(back);
    }
    d.setUTCDate(d.getUTCDate() - 1);
  }
  // A forgiven miss at the far end shouldn't be the reason a streak exists.
  return streak;
}

export async function getStreak(userId: number): Promise<number> {
  const res = await client.execute({
    sql: "SELECT DISTINCT substr(seen_at, 1, 10) AS day FROM user_cards WHERE user_id = ? AND seen_at >= ?",
    args: [userId, new Date(Date.now() - 400 * 86400000).toISOString()],
  });
  return computeStreak((res.rows as any[]).map((r) => r.day as string), new Date().toISOString().slice(0, 10));
}

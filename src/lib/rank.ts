// Feed ranking (Phase 14). Pure functions — no database, no clock reads —
// so the behaviour is unit-testable (see tests/rank.test.ts).
//
// A candidate card's score combines: does the reader follow this interest,
// does it fit their level, is it fresh (news decays, concepts don't), what
// have they engaged with or skipped lately, and is it the right next thing
// to learn (prerequisites known, next in its series).
import type { CardType, Level } from "@/db/schema";
import { LEVELS } from "@/db/schema";

export interface Candidate {
  id: number;
  type: CardType;
  interestId: number | null;
  level: Level | null;
  conceptId: number | null;
  deepDiveId: number | null;
  seq: number; // order inside its deep dive
  diveSeq: number | null; // the deep dive's position in its series
  createdAt: string; // ISO or "YYYY-MM-DD HH:MM:SS" (UTC)
}

export interface RankContext {
  now: number; // ms since epoch
  daySeed: number; // changes daily; keeps the order stable within a day
  interests: Map<number, { level: Level; isFavorite: boolean }>;
  interestAffinity: Map<number, number>; // -1 … 1 from recent behaviour
  typeAffinity: Map<string, number>; // -1 … 1
  knownConcepts: Set<number>;
  prereqs: Map<number, number[]>; // conceptId -> prerequisite concept ids
}

const NEWS_HALF_LIFE_DAYS = 3;
const TIME_SENSITIVE: CardType[] = ["paper", "debate"];

export function parseTime(s: string): number {
  // SQLite's current_timestamp has no zone marker but is UTC.
  return Date.parse(s.includes("T") ? s : s.replace(" ", "T") + "Z");
}

export function levelDistance(a: Level, b: Level): number {
  return Math.abs(LEVELS.indexOf(a) - LEVELS.indexOf(b));
}

/** Deterministic pseudo-random in [0, 1) from two integers. */
export function jitter(id: number, seed: number): number {
  let h = (id * 2654435761 + seed * 40503) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export function scoreCandidate(c: Candidate, ctx: RankContext, explore = false): number {
  let score = explore ? 0.4 : 1;

  const pref = c.interestId !== null ? ctx.interests.get(c.interestId) : undefined;
  if (pref) {
    score += 1;
    if (pref.isFavorite) score += 0.5;
    if (c.level === null) score += 0.3;
    else {
      const d = levelDistance(c.level, pref.level);
      score += d === 0 ? 0.6 : d === 1 ? 0.1 : -0.6;
    }
  }
  if (c.interestId !== null) score += 0.6 * (ctx.interestAffinity.get(c.interestId) ?? 0);
  score += 0.4 * (ctx.typeAffinity.get(c.type) ?? 0);

  if (TIME_SENSITIVE.includes(c.type)) {
    const ageDays = Math.max(0, (ctx.now - parseTime(c.createdAt)) / 86400000);
    score += 0.8 * Math.pow(0.5, ageDays / NEWS_HALF_LIFE_DAYS);
  }

  // Series order: the earliest unread entry in a series is the one to read next.
  if (c.diveSeq !== null) score += 0.8 / c.diveSeq;

  // Learning value: ready-to-learn beats not-yet-ready.
  if (c.conceptId !== null) {
    const pre = ctx.prereqs.get(c.conceptId) ?? [];
    if (pre.length > 0) {
      const known = pre.filter((p) => ctx.knownConcepts.has(p)).length;
      score += known === pre.length ? 0.3 : -0.3 * (1 - known / pre.length);
    }
  }

  return score + 0.3 * (jitter(c.id, ctx.daySeed) - 0.5);
}

export interface AssembleOptions {
  count: number;
  exploreEvery: number; // one exploration card per N slots (0 = none)
  maxSameInterestRun: number;
  // Deep dives the reader has already seen a non-quiz card from: quiz cards
  // for those may appear; quiz cards for unseen deep dives wait their turn.
  introducedDives: Set<number>;
}

export const DEFAULT_ASSEMBLE: Omit<AssembleOptions, "introducedDives"> = {
  count: 10,
  exploreEvery: 7,
  maxSameInterestRun: 2,
};

/**
 * Orders scored candidates into a page: highest score first, but
 *  - cards from one deep dive come out in their written order,
 *  - a quiz never appears before a teaching card from its deep dive,
 *  - no more than `maxSameInterestRun` cards from one interest in a row,
 *  - every `exploreEvery`-th slot is an exploration card when one exists.
 */
export function assemblePage<T extends Candidate>(
  main: { card: T; score: number }[],
  explore: { card: T; score: number }[],
  opts: AssembleOptions
): { card: T; explore: boolean }[] {
  const pool = [...main].sort((a, b) => b.score - a.score).map((x) => x.card);
  const explorePool = [...explore].sort((a, b) => b.score - a.score).map((x) => x.card);
  const introduced = new Set(opts.introducedDives);
  const out: { card: T; explore: boolean }[] = [];
  const used = new Set<number>();

  // For in-order delivery within a deep dive.
  const byDive = new Map<number, T[]>();
  for (const c of pool) {
    if (c.deepDiveId === null) continue;
    if (!byDive.has(c.deepDiveId)) byDive.set(c.deepDiveId, []);
    byDive.get(c.deepDiveId)!.push(c);
  }
  for (const list of byDive.values()) list.sort((a, b) => a.seq - b.seq);

  const runLength = (interestId: number | null): number => {
    let n = 0;
    for (let i = out.length - 1; i >= 0 && out[i].card.interestId === interestId; i--) n++;
    return n;
  };

  const eligible = (c: T, strict: boolean): T | null => {
    if (used.has(c.id)) return null;
    let pick = c;
    if (c.deepDiveId !== null) {
      // Swap in the earliest unused card of the same deep dive.
      const first = byDive.get(c.deepDiveId)!.find((x) => !used.has(x.id));
      if (first) pick = first;
      if (pick.type === "quiz" && !introduced.has(c.deepDiveId)) return null;
    }
    if (strict && runLength(pick.interestId) >= opts.maxSameInterestRun) return null;
    if (strict && pick.type === "quiz" && out.length > 0 && out[out.length - 1].card.type === "quiz") return null;
    return pick;
  };

  while (out.length < opts.count) {
    const slot = out.length + 1;
    if (opts.exploreEvery > 0 && slot % opts.exploreEvery === 0) {
      const e = explorePool.find((c) => !used.has(c.id));
      if (e) {
        used.add(e.id);
        out.push({ card: e, explore: true });
        continue;
      }
    }
    let pick: T | null = null;
    for (const strict of [true, false]) {
      for (const c of pool) {
        pick = eligible(c, strict);
        if (pick) break;
      }
      if (pick) break;
    }
    if (!pick) {
      // Main pool is exhausted: fill with exploration rather than end early.
      const e = explorePool.find((c) => !used.has(c.id));
      if (!e) break;
      used.add(e.id);
      out.push({ card: e, explore: true });
      continue;
    }
    used.add(pick.id);
    if (pick.deepDiveId !== null && pick.type !== "quiz") introduced.add(pick.deepDiveId);
    out.push({ card: pick, explore: false });
  }
  return out;
}

export interface BehaviourRow {
  interestId: number | null;
  cardType: string;
  completed: boolean;
  expanded: boolean;
  saved: boolean;
  skippedFast: boolean;
  answeredCorrect: boolean | null;
}

/** Turns recent per-card behaviour into -1…1 affinities per interest and per card type. */
export function computeAffinities(rows: BehaviourRow[]): {
  interestAffinity: Map<number, number>;
  typeAffinity: Map<string, number>;
} {
  const acc = (m: Map<any, { sum: number; n: number }>, key: any, v: number) => {
    const cur = m.get(key) ?? { sum: 0, n: 0 };
    cur.sum += v;
    cur.n += 1;
    m.set(key, cur);
  };
  const byInterest = new Map<number, { sum: number; n: number }>();
  const byType = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const v =
      (r.completed ? 0.5 : 0) + (r.expanded ? 0.7 : 0) + (r.saved ? 1 : 0) + (r.answeredCorrect !== null ? 0.3 : 0) - (r.skippedFast ? 1 : 0);
    if (r.interestId !== null) acc(byInterest, r.interestId, v);
    acc(byType, r.cardType, v);
  }
  // Shrink toward 0 until there are enough observations to trust the signal.
  const finish = <K>(m: Map<K, { sum: number; n: number }>): Map<K, number> => {
    const out = new Map<K, number>();
    for (const [k, { sum, n }] of m) out.set(k, Math.max(-1, Math.min(1, sum / (n + 4))));
    return out;
  };
  return { interestAffinity: finish(byInterest), typeAffinity: finish(byType) };
}

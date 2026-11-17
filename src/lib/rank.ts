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
  // Finer-grained taste, learned from how long cards were read, rereads, etc.
  diveAffinity?: Map<number, number>; // deepDiveId -> -1 … 1
  conceptAffinity?: Map<number, number>; // conceptId -> -1 … 1
  relatedConcepts?: Map<number, number[]>; // candidate conceptId -> linked concept ids (any edge kind)
  historySize?: number; // cards this reader has been shown (up to the 300 looked at)
}

const NEWS_HALF_LIFE_DAYS = 3;
const TIME_SENSITIVE: CardType[] = ["paper", "debate"];
// Curated one-liners (facts, mental models, games) are palate cleansers
// between substantial cards, so they rank below anything from a series.
const FILLER: CardType[] = ["fact", "model", "game"];
const FILLER_PENALTY = 0.9;

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
  // The rest of an entry the reader lingered on (or bailed out of).
  if (c.deepDiveId !== null) score += 0.5 * (ctx.diveAffinity?.get(c.deepDiveId) ?? 0);
  // Ideas, and ideas linked to ideas, the reader has responded to.
  if (c.conceptId !== null && ctx.conceptAffinity) {
    score += 0.4 * (ctx.conceptAffinity.get(c.conceptId) ?? 0);
    const linked = (ctx.relatedConcepts?.get(c.conceptId) ?? []).filter((id) => ctx.conceptAffinity!.has(id));
    if (linked.length > 0) {
      score += (0.3 * linked.reduce((s, id) => s + ctx.conceptAffinity!.get(id)!, 0)) / linked.length;
    }
  }

  if (TIME_SENSITIVE.includes(c.type)) {
    const ageDays = Math.max(0, (ctx.now - parseTime(c.createdAt)) / 86400000);
    score += 0.8 * Math.pow(0.5, ageDays / NEWS_HALF_LIFE_DAYS);
  }

  if (FILLER.includes(c.type)) score -= FILLER_PENALTY;

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

/** Exploration slots: one in `exploreEvery`. Newer readers get more, so the feed learns their taste quickly. */
export function exploreEveryFor(historySize: number): number {
  return historySize < 30 ? 4 : DEFAULT_ASSEMBLE.exploreEvery;
}

export interface BehaviourRow {
  interestId: number | null;
  cardType: string;
  completed: boolean;
  expanded: boolean;
  saved: boolean;
  skippedFast: boolean;
  answeredCorrect: boolean | null;
  // Optional so older callers keep working; present when read from user_cards.
  dwellMs?: number;
  bodyChars?: number;
  revisits?: number;
  conceptId?: number | null;
  deepDiveId?: number | null;
}

/** Roughly how long a careful reader takes over a card: a beat to orient, then ~240 words a minute. */
export function expectedReadMs(bodyChars: number): number {
  const words = Math.max(0, bodyChars) / 5.5;
  return 1500 + words * 250;
}

/**
 * Time on a card relative to its length, as -0.6 … 0.6. Reading about as long
 * as the card needs is positive; leaving after a fraction of it is negative.
 * Very long stays (phone put down) say nothing, so they count as neutral.
 */
export function dwellSignal(dwellMs: number, bodyChars: number): number {
  if (dwellMs <= 0) return 0;
  const ratio = dwellMs / expectedReadMs(bodyChars);
  if (ratio > 6) return 0;
  return Math.max(-0.6, Math.min(0.6, 0.6 * Math.log2(ratio / 0.6)));
}

/** One card's engagement value: positive when the reader valued it. */
export function engagementValue(r: BehaviourRow): number {
  let v =
    (r.completed ? 0.5 : 0) + (r.expanded ? 0.7 : 0) + (r.saved ? 1 : 0) + (r.answeredCorrect !== null ? 0.3 : 0) - (r.skippedFast ? 1 : 0);
  // Quiz time is spent answering, not reading; fast skips are already counted.
  if (!r.skippedFast && r.cardType !== "quiz" && r.dwellMs !== undefined && r.bodyChars !== undefined) {
    v += dwellSignal(r.dwellMs, r.bodyChars);
  }
  if ((r.revisits ?? 0) > 0) v += 0.6;
  return v;
}

/** Turns recent per-card behaviour into -1…1 affinities per interest, card type, deep dive and concept. */
export function computeAffinities(rows: BehaviourRow[]): {
  interestAffinity: Map<number, number>;
  typeAffinity: Map<string, number>;
  diveAffinity: Map<number, number>;
  conceptAffinity: Map<number, number>;
} {
  const acc = (m: Map<any, { sum: number; n: number }>, key: any, v: number) => {
    const cur = m.get(key) ?? { sum: 0, n: 0 };
    cur.sum += v;
    cur.n += 1;
    m.set(key, cur);
  };
  const byInterest = new Map<number, { sum: number; n: number }>();
  const byType = new Map<string, { sum: number; n: number }>();
  const byDive = new Map<number, { sum: number; n: number }>();
  const byConcept = new Map<number, { sum: number; n: number }>();
  for (const r of rows) {
    const v = engagementValue(r);
    if (r.interestId !== null) acc(byInterest, r.interestId, v);
    acc(byType, r.cardType, v);
    if (r.deepDiveId != null) acc(byDive, r.deepDiveId, v);
    if (r.conceptId != null) acc(byConcept, r.conceptId, v);
  }
  // Shrink toward 0 until there are enough observations to trust the signal.
  // Dives and concepts have only a handful of cards each, so they shrink less.
  const finish = <K>(m: Map<K, { sum: number; n: number }>, prior: number): Map<K, number> => {
    const out = new Map<K, number>();
    for (const [k, { sum, n }] of m) out.set(k, Math.max(-1, Math.min(1, sum / (n + prior))));
    return out;
  };
  return {
    interestAffinity: finish(byInterest, 4),
    typeAffinity: finish(byType, 4),
    diveAffinity: finish(byDive, 1),
    conceptAffinity: finish(byConcept, 1),
  };
}

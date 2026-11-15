import { describe, expect, it } from "vitest";
import { assemblePage, computeAffinities, scoreCandidate, jitter, DEFAULT_ASSEMBLE } from "@/lib/rank";
import type { Candidate, RankContext } from "@/lib/rank";

const NOW = Date.parse("2026-11-10T12:00:00Z");

function ctx(over: Partial<RankContext> = {}): RankContext {
  return {
    now: NOW,
    daySeed: 1,
    interests: new Map([[1, { level: "some_background", isFavorite: false }]]),
    interestAffinity: new Map(),
    typeAffinity: new Map(),
    knownConcepts: new Set(),
    prereqs: new Map(),
    ...over,
  };
}

let nextId = 1;
function card(over: Partial<Candidate> = {}): Candidate {
  return {
    id: nextId++,
    type: "bite",
    interestId: 1,
    level: "some_background",
    conceptId: null,
    deepDiveId: null,
    seq: 0,
    diveSeq: null,
    createdAt: "2026-11-10 11:00:00",
    ...over,
  };
}

describe("scoreCandidate", () => {
  it("prefers a followed interest over an unfollowed one", () => {
    const followed = card({ id: 10 });
    const other = card({ id: 10, interestId: 2 });
    expect(scoreCandidate(followed, ctx())).toBeGreaterThan(scoreCandidate(other, ctx()));
  });

  it("prefers the reader's level, and penalises a far level", () => {
    const exact = scoreCandidate(card({ id: 5 }), ctx());
    const near = scoreCandidate(card({ id: 5, level: "advanced" }), ctx());
    const far = scoreCandidate(card({ id: 5, level: "research_level" }), ctx());
    expect(exact).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(far);
  });

  it("decays news with age but not concept cards", () => {
    const fresh = scoreCandidate(card({ id: 7, type: "paper", level: null, createdAt: "2026-11-10 11:00:00" }), ctx());
    const stale = scoreCandidate(card({ id: 7, type: "paper", level: null, createdAt: "2026-10-20 11:00:00" }), ctx());
    expect(fresh).toBeGreaterThan(stale);
    const biteNew = scoreCandidate(card({ id: 7, createdAt: "2026-11-10 11:00:00" }), ctx());
    const biteOld = scoreCandidate(card({ id: 7, createdAt: "2026-01-01 11:00:00" }), ctx());
    expect(biteNew).toBe(biteOld);
  });

  it("ranks the next entry in a series above later ones", () => {
    expect(scoreCandidate(card({ id: 3, diveSeq: 1 }), ctx())).toBeGreaterThan(scoreCandidate(card({ id: 3, diveSeq: 4 }), ctx()));
  });

  it("rewards concepts whose prerequisites are known", () => {
    const c = card({ id: 9, conceptId: 50 });
    const ready = scoreCandidate(c, ctx({ prereqs: new Map([[50, [40]]]), knownConcepts: new Set([40]) }));
    const notReady = scoreCandidate(c, ctx({ prereqs: new Map([[50, [40]]]) }));
    expect(ready).toBeGreaterThan(notReady);
  });

  it("moves with the reader's behaviour", () => {
    const c = card({ id: 11 });
    const liked = scoreCandidate(c, ctx({ interestAffinity: new Map([[1, 1]]) }));
    const disliked = scoreCandidate(c, ctx({ interestAffinity: new Map([[1, -1]]) }));
    expect(liked).toBeGreaterThan(disliked);
  });
});

describe("jitter", () => {
  it("is deterministic and inside [0, 1)", () => {
    for (let i = 1; i < 200; i++) {
      const v = jitter(i, 42);
      expect(v).toBe(jitter(i, 42));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("assemblePage", () => {
  const opts = { ...DEFAULT_ASSEMBLE, introducedDives: new Set<number>() };

  it("delivers a deep dive's cards in written order, quiz after teaching", () => {
    const cards = [
      card({ id: 101, deepDiveId: 1, seq: 3, type: "quiz" }),
      card({ id: 102, deepDiveId: 1, seq: 1 }),
      card({ id: 103, deepDiveId: 1, seq: 0 }),
    ];
    // Score the quiz highest on purpose: order must still be 103, 102, 101.
    const page = assemblePage(
      cards.map((c, i) => ({ card: c, score: 10 - i })),
      [],
      { ...opts, count: 3, maxSameInterestRun: 9 }
    );
    expect(page.map((p) => p.card.id)).toEqual([103, 102, 101]);
  });

  it("never opens with a quiz for an entry the reader hasn't started", () => {
    const quizOnly = [card({ id: 201, deepDiveId: 2, seq: 5, type: "quiz" })];
    expect(assemblePage(quizOnly.map((c) => ({ card: c, score: 5 })), [], { ...opts, count: 3 })).toEqual([]);
    const introduced = assemblePage(quizOnly.map((c) => ({ card: c, score: 5 })), [], { ...opts, count: 3, introducedDives: new Set([2]) });
    expect(introduced.map((p) => p.card.id)).toEqual([201]);
  });

  it("avoids long runs of one interest when alternatives exist", () => {
    const a = [1, 2, 3, 4].map((n) => card({ id: 300 + n, interestId: 1 }));
    const b = [1, 2].map((n) => card({ id: 400 + n, interestId: 2 }));
    const page = assemblePage(
      [...a.map((c) => ({ card: c, score: 9 })), ...b.map((c) => ({ card: c, score: 1 }))],
      [],
      { ...opts, count: 6, exploreEvery: 0 }
    );
    const ids = page.map((p) => p.card.interestId);
    for (let i = 2; i < ids.length; i++) {
      // No three in a row while the other interest still had cards left.
      if (ids[i] === ids[i - 1] && ids[i] === ids[i - 2]) expect(ids.slice(i).includes(2)).toBe(false);
    }
    expect(page).toHaveLength(6);
  });

  it("puts an exploration card in every Nth slot", () => {
    const main = Array.from({ length: 20 }, (_, n) => card({ id: 500 + n, interestId: (n % 3) + 1 }));
    const explore = [card({ id: 900, interestId: 99 }), card({ id: 901, interestId: 98 })];
    const page = assemblePage(main.map((c) => ({ card: c, score: 5 })), explore.map((c) => ({ card: c, score: 1 })), { ...opts, count: 14, exploreEvery: 7 });
    expect(page[6].explore).toBe(true);
    expect(page[13].explore).toBe(true);
    expect(page.filter((p) => p.explore)).toHaveLength(2);
  });

  it("never repeats a card", () => {
    const main = Array.from({ length: 8 }, (_, n) => card({ id: 600 + n, deepDiveId: 6, seq: n }));
    const page = assemblePage(main.map((c) => ({ card: c, score: Math.random() })), [], { ...opts, count: 8, maxSameInterestRun: 2 });
    expect(new Set(page.map((p) => p.card.id)).size).toBe(page.length);
    expect(page).toHaveLength(8);
  });
});

describe("computeAffinities", () => {
  const row = (over: Partial<Parameters<typeof computeAffinities>[0][number]>) => ({
    interestId: 1,
    cardType: "bite",
    completed: false,
    expanded: false,
    saved: false,
    skippedFast: false,
    answeredCorrect: null,
    ...over,
  });

  it("goes positive for saves and negative for fast skips", () => {
    const liked = computeAffinities(Array.from({ length: 20 }, () => row({ saved: true, completed: true })));
    const skipped = computeAffinities(Array.from({ length: 20 }, () => row({ skippedFast: true })));
    expect(liked.interestAffinity.get(1)!).toBeGreaterThan(0.5);
    expect(skipped.interestAffinity.get(1)!).toBeLessThan(-0.5);
  });

  it("stays near zero on thin evidence and inside [-1, 1]", () => {
    const one = computeAffinities([row({ saved: true })]);
    expect(Math.abs(one.interestAffinity.get(1)!)).toBeLessThan(0.3);
    const many = computeAffinities(Array.from({ length: 500 }, () => row({ saved: true, expanded: true, completed: true })));
    expect(many.interestAffinity.get(1)!).toBeLessThanOrEqual(1);
  });
});

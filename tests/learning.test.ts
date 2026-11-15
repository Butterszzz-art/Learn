import { describe, expect, it, vi } from "vitest";

// learning.ts and its neighbours import the database client at module load;
// the functions under test here are pure, so a stub is enough.
vi.mock("@/db", () => ({ client: { execute: vi.fn() }, db: {} }));

import { EMPTY_STATE, masteryOf, scheduleNext } from "@/lib/learning";
import { computeStreak } from "@/lib/explore";
import { looksLikeValidMermaid } from "@/lib/engine/expand";
import { estimateCostUsd } from "@/lib/ai";
import { badgeFor, firstSentence } from "@/lib/engine/news";
import { jobKey } from "@/lib/engine/jobs";

const DAY = 86400000;

describe("scheduleNext (FSRS)", () => {
  const start = new Date("2026-11-10T12:00:00Z");

  it("schedules a first correct answer at least a day out", () => {
    const next = scheduleNext(EMPTY_STATE, "good", start);
    expect(next.reps).toBe(1);
    expect(new Date(next.due!).getTime() - start.getTime()).toBeGreaterThanOrEqual(DAY);
  });

  it("spaces reviews further apart after each success", () => {
    let state = EMPTY_STATE;
    let now = start;
    const gaps: number[] = [];
    for (let i = 0; i < 5; i++) {
      state = scheduleNext(state, "good", now);
      const due = new Date(state.due!);
      gaps.push(due.getTime() - now.getTime());
      now = due;
    }
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
  });

  it("brings a forgotten idea back sooner and counts the lapse", () => {
    let state = EMPTY_STATE;
    let now = start;
    for (let i = 0; i < 4; i++) {
      state = scheduleNext(state, "good", now);
      now = new Date(state.due!);
    }
    const stableGap = new Date(scheduleNext(state, "good", now).due!).getTime() - now.getTime();
    const forgot = scheduleNext(state, "again", now);
    expect(new Date(forgot.due!).getTime() - now.getTime()).toBeLessThan(stableGap);
    expect(forgot.lapses).toBe(state.lapses + 1);
  });

  it("gives 'easy' a longer gap than 'good'", () => {
    const good = scheduleNext(EMPTY_STATE, "good", start);
    const easy = scheduleNext(EMPTY_STATE, "easy", start);
    expect(new Date(easy.due!).getTime()).toBeGreaterThan(new Date(good.due!).getTime());
  });
});

describe("masteryOf", () => {
  it("maps state to the five map levels", () => {
    expect(masteryOf(null)).toBe("unseen");
    expect(masteryOf({ reps: 0, state: 0, stability: 0 })).toBe("seen");
    expect(masteryOf({ reps: 1, state: 2, stability: 3 })).toBe("learning");
    expect(masteryOf({ reps: 3, state: 3, stability: 20 })).toBe("learning"); // relearning after a lapse
    expect(masteryOf({ reps: 3, state: 2, stability: 12 })).toBe("recalled");
    expect(masteryOf({ reps: 6, state: 2, stability: 45 })).toBe("mastered");
  });

  it("reaches 'mastered' only after repeated successful recall over time", () => {
    let state = EMPTY_STATE;
    let now = new Date("2026-01-01T00:00:00Z");
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      state = scheduleNext(state, "good", now);
      seen.push(masteryOf(state));
      now = new Date(state.due!);
    }
    expect(seen[0]).not.toBe("mastered");
    expect(seen[seen.length - 1]).toBe("mastered");
  });
});

describe("computeStreak", () => {
  const days = (...d: string[]) => d;
  it("counts consecutive days ending today", () => {
    expect(computeStreak(days("2026-11-08", "2026-11-09", "2026-11-10"), "2026-11-10")).toBe(3);
  });
  it("doesn't break because today hasn't happened yet", () => {
    expect(computeStreak(days("2026-11-08", "2026-11-09"), "2026-11-10")).toBe(2);
  });
  it("forgives one missed day in a week, but not two", () => {
    expect(computeStreak(days("2026-11-06", "2026-11-07", "2026-11-09", "2026-11-10"), "2026-11-10")).toBe(4);
    expect(computeStreak(days("2026-11-05", "2026-11-07", "2026-11-09", "2026-11-10"), "2026-11-10")).toBe(3);
  });
  it("is zero with no activity", () => {
    expect(computeStreak([], "2026-11-10")).toBe(0);
  });
});

describe("content helpers", () => {
  it("accepts a well-formed flowchart and rejects malformed diagrams", () => {
    expect(looksLikeValidMermaid('flowchart TD\n  A["Glutamate"] --> B["NMDA receptor"]')).toBe(true);
    expect(looksLikeValidMermaid('graph TD\n A --> B')).toBe(false);
    expect(looksLikeValidMermaid('flowchart TD\n  A["unbalanced] --> B["x"]')).toBe(false);
    expect(looksLikeValidMermaid("flowchart LR\n  A B C")).toBe(false);
  });

  it("labels sources by evidence type", () => {
    expect(badgeFor("academic", "bioRxiv")).toBe("preprint");
    expect(badgeFor("academic", "arXiv")).toBe("preprint");
    expect(badgeFor("academic", "PubMed")).toBe("peer-reviewed");
    expect(badgeFor("journalism", "Quanta Magazine")).toBe("journalism");
    expect(badgeFor("generated", "Web")).toBe("ai-roundup");
  });

  it("takes the first sentence as a takeaway", () => {
    expect(firstSentence("Sleep consolidates memory. It also clears waste.")).toBe("Sleep consolidates memory.");
    expect(firstSentence("x".repeat(400)).length).toBeLessThanOrEqual(181);
  });

  it("builds stable job keys regardless of property order or case", () => {
    expect(jobKey("topic_dive", { interestId: 3, level: "advanced", topic: "Hebbian Learning" })).toBe(
      jobKey("topic_dive", { topic: "hebbian learning", level: "advanced", interestId: 3 } as any)
    );
    expect(jobKey("news", { interestId: 1 })).not.toBe(jobKey("news", { interestId: 2 }));
  });

  it("prices a call from its token usage", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 };
    expect(estimateCostUsd("claude-haiku-5-5", usage)).toBeCloseTo(0.6, 5);
    expect(estimateCostUsd("claude-sonnet-5-5", usage)).toBeCloseTo(12, 5);
    expect(estimateCostUsd("claude-opus-5-5", { ...usage, webSearches: 5 })).toBeCloseTo(24.05, 5);
  });
});

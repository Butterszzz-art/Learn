import { describe, expect, it } from "vitest";
import { computeCardTypeStats, computeRetention, computeSessions, median, toDayIndex } from "@/lib/metrics";

const today = toDayIndex("2026-11-17");
const days = (...isos: string[]) => new Set(isos.map(toDayIndex));

describe("computeRetention", () => {
  const users = [
    { id: 1, createdAt: "2026-10-01 09:00:00" }, // came back day 1 and in week 2
    { id: 2, createdAt: "2026-10-01 09:00:00" }, // never came back
    { id: 3, createdAt: "2026-11-16 09:00:00" }, // too new for any window
  ];
  const active = new Map([
    [1, days("2026-10-01", "2026-10-02", "2026-10-09")],
    [2, days("2026-10-01")],
    [3, days("2026-11-16")],
  ]);
  const [d1, w2, m2] = computeRetention(users, active, today);

  it("only counts people whose window has passed", () => {
    expect(d1.eligible).toBe(2);
    expect(w2.eligible).toBe(2);
    expect(m2.eligible).toBe(0);
    expect(m2.rate).toBeNull();
  });

  it("measures the share active in each window", () => {
    expect(d1.rate).toBe(0.5);
    expect(w2.rate).toBe(0.5);
  });
});

describe("computeSessions", () => {
  it("splits on a 30-minute gap and sums reading time", () => {
    const s = computeSessions([
      { userId: 1, seenAt: "2026-11-17T08:00:00Z", dwellMs: 10000 },
      { userId: 1, seenAt: "2026-11-17T08:05:00Z", dwellMs: 20000 },
      { userId: 1, seenAt: "2026-11-17T09:00:00Z", dwellMs: 5000 },
      { userId: 2, seenAt: "2026-11-17T08:01:00Z", dwellMs: 60 * 60000 },
    ]);
    expect(s.map((x) => x.cards).sort()).toEqual([1, 1, 2]);
    expect(Math.max(...s.map((x) => x.readingMs))).toBe(10 * 60000); // capped
  });
});

describe("computeCardTypeStats", () => {
  it("summarises each kind of card", () => {
    const row = { cardType: "bite", dwellMs: 0, bodyChars: 550, completed: false, skippedFast: false, revisits: 0, saved: false };
    const [bite] = computeCardTypeStats([
      { ...row, completed: true, dwellMs: 20000 },
      { ...row, skippedFast: true, dwellMs: 500 },
    ]);
    expect(bite.shown).toBe(2);
    expect(bite.completedRate).toBe(0.5);
    expect(bite.fastSkipRate).toBe(0.5);
    expect(bite.medianReadRatio).not.toBeNull();
  });
});

describe("median", () => {
  it("handles odd, even and empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

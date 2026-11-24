import { describe, expect, it } from "vitest";
import { assembleMonthly, citedNumbers, isPeriod, periodLabel, previousPeriod } from "../src/lib/monthly";
import type { MonthItem, MonthlyDraft } from "../src/lib/monthly";

const items: MonthItem[] = Array.from({ length: 8 }, (_, i) => ({
  id: 100 + i,
  title: `Item ${i + 1}`,
  summary: "s",
  abstract: null,
  sourceName: "Src",
  url: `https://example.org/${i + 1}`,
  date: null,
}));

function draft(body: string): MonthlyDraft {
  return {
    headline: " A month of surprises ",
    standfirst: "Why it mattered.",
    bigStory: { heading: "The big one", body },
    trends: [{ heading: "Trend", body: "More on this [2, 5].", science: "How it works." }],
    signals: ["Watch this [8]."],
    ponder: ["What if?", "Why not?"],
  };
}

describe("monthly periods", () => {
  it("finds the previous month, across a year boundary", () => {
    expect(previousPeriod(new Date("2026-11-03T10:00:00Z"))).toBe("2026-10");
    expect(previousPeriod(new Date("2027-01-01T00:00:00Z"))).toBe("2026-12");
  });
  it("labels and validates periods", () => {
    expect(periodLabel("2026-10")).toBe("October 2026");
    expect(isPeriod("2026-10")).toBe(true);
    expect(isPeriod("2026-13")).toBe(false);
    expect(isPeriod("26-10")).toBe(false);
  });
});

describe("assembleMonthly", () => {
  it("reads single and grouped citations", () => {
    expect(citedNumbers("a [1] b [2, 3] c [x]")).toEqual([1, 2, 3]);
  });

  it("renumbers citations by first use, links them, and drops unknown ones", () => {
    const out = assembleMonthly(draft("Start [3]. Then [1][3]. Bogus [42]."), items)!;
    expect(out).not.toBeNull();
    expect(out.topic).toBe("A month of surprises");
    // Item 3 is cited first, so it becomes source 1.
    expect(out.sources.map((s) => s.url)).toEqual([
      "https://example.org/3",
      "https://example.org/1",
      "https://example.org/2",
      "https://example.org/5",
      "https://example.org/8",
    ]);
    expect(out.content).toContain("Start [[1]](https://example.org/3).");
    expect(out.content).toContain("Then [[2]](https://example.org/1)[[1]](https://example.org/3).");
    expect(out.content).toContain("[[3]](https://example.org/2)[[4]](https://example.org/5)");
    expect(out.content).not.toContain("42");
    expect(out.content).toContain("## Questions to ponder");
    expect(out.content).toContain("> **The science behind it.** How it works.");
    expect(out.essayPrompt).toBe("What if?");
  });

  it("refuses a draft that cites too few real items", () => {
    const thin = { ...draft("Only [1]."), trends: [], signals: [] };
    expect(assembleMonthly(thin, items)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { briefOf, clipAt, isSummaryLength, readMinutes, wordCount } from "@/lib/summaryLength";

describe("summary lengths", () => {
  it("keeps the first two sentences for Brief", () => {
    expect(briefOf("One idea. Two ideas! Three? Four.")).toBe("One idea. Two ideas!");
    expect(briefOf('He said "stop." Then left. Later.')).toBe('He said "stop." Then left.');
  });

  it("leaves short text alone", () => {
    expect(briefOf("Just one sentence.")).toBe("Just one sentence.");
    expect(briefOf("No full stop at all")).toBe("No full stop at all");
  });

  it("counts words and minutes", () => {
    expect(wordCount("  a b   c ")).toBe(3);
    expect(wordCount("")).toBe(0);
    expect(readMinutes("word ".repeat(50))).toBe(1);
    expect(readMinutes("word ".repeat(500))).toBe(3);
  });

  it("clips at a word boundary", () => {
    expect(clipAt("alpha beta gamma", 8)).toBe("alpha…");
    expect(clipAt("short", 100)).toBe("short");
  });

  it("validates stored values", () => {
    expect(isSummaryLength("indepth")).toBe(true);
    expect(isSummaryLength("huge")).toBe(false);
  });
});

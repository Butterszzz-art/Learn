import { describe, expect, it } from "vitest";
import { numbersInText, validEstimate } from "@/lib/engine/expand";
import { formatNumber, guessVerdict, sliderScale } from "@/lib/interactive";
import { summarizeResponses } from "@/lib/responses";

const ENTRY = "The human brain has about 86 billion neurons. Roughly 1,200 people took part, and 37% improved.";
const est = (over: Record<string, unknown> = {}) => ({
  applicable: true,
  question: "How many neurons are in the human brain?",
  answer: 86e9,
  unit: "neurons",
  min: 1e9,
  max: 1e12,
  explanation: "Most of them are in the cerebellum.",
  ...over,
});

describe("numbersInText", () => {
  it("reads plain, comma and scaled numbers", () => {
    const ns = numbersInText(ENTRY);
    expect(ns).toContain(86e9);
    expect(ns).toContain(1200);
    expect(ns).toContain(37);
  });
});

describe("validEstimate", () => {
  it("keeps an estimate whose answer the entry states", () => {
    expect(validEstimate(est(), ENTRY)?.answer).toBe(86e9);
    expect(validEstimate(est({ answer: 37, unit: "%", min: 0, max: 100 }), ENTRY)).not.toBeNull();
  });

  it("rejects numbers the entry never states", () => {
    expect(validEstimate(est({ answer: 100e9 }), ENTRY)).toBeNull();
  });

  it("rejects ranges that don't contain the answer, and inapplicable ones", () => {
    expect(validEstimate(est({ min: 90e9 }), ENTRY)).toBeNull();
    expect(validEstimate(est({ max: 86e9 }), ENTRY)).toBeNull();
    expect(validEstimate(est({ applicable: false }), ENTRY)).toBeNull();
    expect(validEstimate(undefined, ENTRY)).toBeNull();
  });
});

describe("guessVerdict", () => {
  it("grades closeness", () => {
    expect(guessVerdict(95, 100)).toEqual({ label: "Spot on", close: true });
    expect(guessVerdict(120, 100).label).toBe("Close");
    expect(guessVerdict(300, 100).label).toBe("Off by 3.0×");
    expect(guessVerdict(10, 1000).label).toBe("Off by 100×");
    expect(guessVerdict(150, 100).label).toBe("Too high");
  });
});

describe("sliderScale", () => {
  it("uses a log scale for wide ranges and round-trips", () => {
    const s = sliderScale(1e9, 1e12);
    expect(s.log).toBe(true);
    expect(s.toValue(0)).toBeCloseTo(1e9);
    expect(s.toValue(1000)).toBeCloseTo(1e12, -3);
    expect(s.toPos(s.toValue(420))).toBe(420);
    expect(sliderScale(0, 100).log).toBe(false);
    expect(sliderScale(0, 100).toValue(500)).toBe(50);
  });
});

describe("formatNumber", () => {
  it("is compact for big numbers and keeps units", () => {
    expect(formatNumber(86e9, "neurons")).toBe("86B neurons");
    expect(formatNumber(37, "%")).toBe("37%");
    expect(formatNumber(1234)).toBe("1,234");
  });
});

describe("summarizeResponses", () => {
  it("summarises debate sides", () => {
    expect(summarizeResponses("debate", [1, 1, 0, 1]).agreeShare).toBe(0.75);
  });
  it("summarises estimate guesses", () => {
    const s = summarizeResponses("estimate", [80, 100, 120, 500], 100);
    expect(s.medianGuess).toBe(110);
    expect(s.withinQuarter).toBe(0.75);
  });
});

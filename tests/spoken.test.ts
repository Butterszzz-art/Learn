import { describe, expect, it } from "vitest";
import { spokenSegments, spokenText } from "@/lib/spoken";
import type { FeedCard } from "@/lib/cardTypes";

const card = (over: Partial<FeedCard>): FeedCard => ({
  key: "k",
  kind: "bite",
  cardId: 1,
  interestId: 1,
  interestName: "Neuroscience",
  level: null,
  title: "Title",
  body: "Body text.",
  payload: {},
  conceptId: null,
  conceptName: null,
  deepDiveId: null,
  deepDiveTopic: null,
  explore: false,
  saved: false,
  aiGenerated: true,
  ...over,
});

describe("spokenSegments", () => {
  it("gives a thinking pause before a puzzle's answer", () => {
    const s = spokenSegments(card({ title: "Why do we sleep?", payload: { kind: "puzzle" } }));
    expect(s[0].text).toBe("Why do we sleep?");
    expect(s[0].pauseAfterMs).toBeGreaterThan(2000);
    expect(s[1].text).toBe("Body text.");
  });

  it("reads quiz options, pauses, then the answer", () => {
    const s = spokenSegments(card({ kind: "quiz", body: "Which?", payload: { options: ["x", "y", "z", "w"], correctIndex: 2, explanation: "Because." } }));
    expect(s.map((x) => x.text)).toEqual(["Which?", "A: x. B: y. C: z. D: w.", "The answer is C: z.", "Because."]);
    expect(s[1].pauseAfterMs).toBeGreaterThan(2000);
  });

  it("asks for a guess before saying an estimate's answer", () => {
    const text = spokenText(card({ kind: "estimate", title: "How many neurons?", payload: { answer: 86e9, unit: "neurons", explanation: "Lots." } }));
    expect(text).toBe("How many neurons? Have a guess. The answer: 86B neurons. Lots.");
  });

  it("has nothing to say on placeholder cards", () => {
    expect(spokenSegments(card({ kind: "brewing", cardId: null }))).toEqual([]);
    expect(spokenSegments(card({ kind: "caughtup", cardId: null }))).toEqual([]);
  });

  it("skips empty parts", () => {
    expect(spokenSegments(card({ payload: { takeaway: "  " } })).length).toBe(2);
  });
});

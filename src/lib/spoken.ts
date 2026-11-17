// What Listen mode says for each card, as segments with pauses between them.
// Written for the ear: answers are announced after a beat, so a puzzle or a
// guess-the-number card still gives the listener a moment to think.
// Client-safe; unit-tested in tests/spoken.test.ts.
import type { FeedCard } from "./cardTypes";
import { formatNumber } from "./interactive";

export interface Segment {
  text: string;
  pauseAfterMs: number;
}

const BEAT = 600;
const THINK = 3500;

const clean = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
const seg = (text: unknown, pauseAfterMs = BEAT): Segment | null => (clean(text) ? { text: clean(text), pauseAfterMs } : null);
const letters = ["A", "B", "C", "D", "E", "F"];

function quiz(question: string, options: string[], correctIndex: number, explanation: string): (Segment | null)[] {
  return [
    seg(question, BEAT),
    seg(options.map((o, i) => `${letters[i]}: ${o}.`).join(" "), THINK),
    seg(`The answer is ${letters[correctIndex] ?? ""}: ${options[correctIndex] ?? ""}.`),
    seg(explanation),
  ];
}

/** Segments to read aloud for a card; empty when the card has nothing to listen to. */
export function spokenSegments(card: FeedCard): Segment[] {
  const p = card.payload ?? {};
  let out: (Segment | null)[];
  switch (card.kind) {
    case "bite":
      out =
        p.kind === "puzzle"
          ? [seg(card.title, THINK), seg(card.body), seg(p.takeaway)]
          : [seg(card.title), seg(card.body), seg(p.takeaway)];
      break;
    case "quiz":
      out = quiz(card.body, p.options ?? [], p.correctIndex ?? 0, p.explanation ?? "");
      break;
    case "review":
      out = p.quiz
        ? [seg(`You met ${card.title} a while ago.`), ...quiz(p.quiz.question, p.quiz.options ?? [], p.quiz.correctIndex ?? 0, p.quiz.explanation ?? "")]
        : [seg(`Without looking it up: what is ${card.title}?`, THINK), seg(card.body)];
      break;
    case "estimate":
      out = [
        seg(card.title),
        seg("Have a guess.", THINK),
        seg(`The answer: ${formatNumber(Number(p.answer), p.unit ?? "")}.`),
        seg(p.explanation ?? card.body),
      ];
      break;
    case "debate":
      out = [seg(card.title), seg(`The claim: ${clean(p.claim)}`, 1500), seg(`The strongest case against it: ${card.body}`)];
      break;
    case "myth":
      out = [seg(`Myth: ${clean(p.myth ?? card.title)}`, 1500), seg(`What's actually true: ${clean(p.fact ?? card.body)}`)];
      break;
    case "paper":
      out = [seg(card.title), seg(p.takeaway), seg(card.body)];
      break;
    case "visual":
      out = [seg(card.title), seg(p.caption ?? card.body)];
      break;
    case "game":
      out = [seg(card.body, THINK), seg(`The answer: ${clean(p.answer)}`)];
      break;
    case "insight":
      out = [seg(`Something to try, from ${card.title}.`), seg(card.body)];
      break;
    case "recap":
    case "chapter":
    case "fact":
    case "model":
      out = [seg(card.title), seg(card.body)];
      break;
    default:
      // brewing / caught up: nothing to read, Listen mode stops here.
      out = [];
  }
  return out.filter((s): s is Segment => s !== null);
}

/** One string for the per-card Listen button. */
export function spokenText(card: FeedCard): string {
  return spokenSegments(card)
    .map((s) => s.text)
    .join(" ");
}

"use client";

import { QuizBlock } from "./feed/QuizBlock";
import { EstimateBody } from "./feed/CardView";
import type { FeedCard } from "@/lib/cardTypes";
import type { PublicCard } from "@/lib/publicCard";

/** A shared quiz or guess-the-number card, playable without an account. Answers aren't recorded. */
export function PublicChallenge({ title, challenge }: { title: string; challenge: NonNullable<PublicCard["challenge"]> }) {
  if (challenge.kind === "quiz") {
    return (
      <QuizBlock question={title} options={challenge.options} correctIndex={challenge.correctIndex} explanation={challenge.explanation} onAnswer={() => {}} />
    );
  }
  const card: FeedCard = {
    key: "challenge",
    kind: "estimate",
    cardId: null, // no account: nothing is sent
    interestId: null,
    interestName: null,
    level: null,
    title,
    body: challenge.explanation,
    payload: { answer: challenge.answer, unit: challenge.unit, min: challenge.min, max: challenge.max, explanation: challenge.explanation },
    conceptId: null,
    conceptName: null,
    deepDiveId: null,
    deepDiveTopic: null,
    explore: false,
    saved: false,
    aiGenerated: true,
  };
  return <EstimateBody card={card} onAnswer={() => {}} />;
}

"use client";

import { useState } from "react";

/**
 * One multiple-choice question with instant feedback. The answer is
 * reported once via onAnswer; the parent decides what to do with it
 * (the feed saves it and updates the concept's review schedule).
 */
export function QuizBlock({
  question,
  options,
  correctIndex,
  explanation,
  onAnswer,
  compact = false,
}: {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  onAnswer?: (correct: boolean) => void;
  compact?: boolean;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;

  function pick(i: number) {
    if (answered) return;
    setPicked(i);
    const correct = i === correctIndex;
    try {
      navigator.vibrate?.(correct ? 12 : [20, 40, 20]);
    } catch {}
    onAnswer?.(correct);
  }

  return (
    <div className="w-full">
      <p className={`whitespace-pre-line font-bold leading-snug text-neuron-text ${compact ? "text-base" : "text-xl sm:text-2xl"}`}>{question}</p>
      <div className="mt-4 grid gap-2.5" role="group" aria-label="Answer options">
        {options.map((opt, i) => {
          const isCorrect = i === correctIndex;
          const isPicked = i === picked;
          let tone = "border-neuron-border bg-neuron-surface2 hover:border-neuron-accent/60";
          if (answered && isCorrect) tone = "border-neuron-accent3 bg-neuron-accent3/15";
          else if (answered && isPicked) tone = "border-neuron-danger bg-neuron-danger/10";
          else if (answered) tone = "border-neuron-border bg-neuron-surface2 opacity-60";
          return (
            <button
              key={i}
              type="button"
              disabled={answered}
              onClick={() => pick(i)}
              className={`flex min-h-[48px] w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left text-[15px] font-semibold leading-snug text-neuron-text transition ${tone}`}
            >
              <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-xs font-extrabold opacity-70">
                {answered && isCorrect ? "✓" : answered && isPicked ? "✕" : String.fromCharCode(65 + i)}
              </span>
              <span>{opt}</span>
              {answered && isCorrect && <span className="sr-only"> (correct answer)</span>}
              {answered && isPicked && !isCorrect && <span className="sr-only"> (your answer, incorrect)</span>}
            </button>
          );
        })}
      </div>
      <div aria-live="polite">
        {answered && (
          <div className="mt-4 rounded-2xl bg-neuron-surface2 p-4 text-sm leading-relaxed text-neuron-text">
            <p className={`mb-1 font-extrabold ${picked === correctIndex ? "text-neuron-accent3" : "text-neuron-danger"}`}>
              {picked === correctIndex ? "Correct" : "Not quite"}
            </p>
            {explanation}
          </div>
        )}
      </div>
    </div>
  );
}

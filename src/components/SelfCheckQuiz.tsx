"use client";

import { useState } from "react";

interface SelfCheckQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

/** Retrieval-practice self-check at the end of a deep dive's reading view.
 * Selecting an option reveals immediately whether it's correct plus a
 * one-line explanation — purely for the reader's own recall. No score is
 * computed and no answer is ever sent anywhere or persisted. */
export function SelfCheckQuiz({ questions }: { questions: SelfCheckQuestion[] }) {
  if (questions.length === 0) return null;

  return (
    <div className="mt-10 border-t border-neuron-border pt-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neuron-muted">
        Self-check
      </h2>
      <div className="space-y-4">
        {questions.map((q, i) => (
          <QuizQuestion key={i} q={q} />
        ))}
      </div>
    </div>
  );
}

function QuizQuestion({ q }: { q: SelfCheckQuestion }) {
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <div className="card">
      <p className="mb-3 font-medium">{q.question}</p>
      <div className="space-y-2">
        {q.options.map((option, i) => {
          const isSelected = selected === i;
          const isCorrect = i === q.correctIndex;
          const showState = selected !== null;
          let style = "border-neuron-border hover:border-neuron-accent";
          if (showState && isCorrect) style = "border-green-500/60 bg-green-500/10";
          else if (showState && isSelected && !isCorrect) style = "border-red-500/60 bg-red-500/10";

          return (
            <button
              key={i}
              type="button"
              onClick={() => setSelected(i)}
              disabled={selected !== null}
              className={`block w-full rounded-2xl border p-2.5 text-left text-sm transition disabled:cursor-default ${style}`}
            >
              {option}
              {showState && isSelected && (
                <span className="ml-2 text-xs">{isCorrect ? "✓ correct" : "✕ not quite"}</span>
              )}
            </button>
          );
        })}
      </div>
      {selected !== null && (
        <p className="mt-3 text-xs leading-relaxed text-neuron-muted">{q.explanation}</p>
      )}
    </div>
  );
}

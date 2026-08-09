"use client";

import { useState } from "react";
import Link from "next/link";
import type { DrillSummary } from "@/lib/digest";
import { DRILL_TYPE_LABELS } from "@/db/schema";

/** A single Drill: pick an option, get immediate feedback + explanation.
 * Visually distinct from reading material (teal accent, "practice" framing)
 * — same reveal-on-select pattern as SelfCheckQuiz, but its own component
 * since drills render inline in the feed, not just at the end of a dive. */
export function DrillCard({ entry }: { entry: DrillSummary }) {
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <div className="card border-neuron-accent3/40 bg-gradient-to-br from-neuron-surface to-neuron-surface2">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="pill border-neuron-accent3/50 text-neuron-accent3">
          🧩 Drill · {DRILL_TYPE_LABELS[entry.drillType]}
        </span>
        {entry.sourceDeepDiveId && (
          <Link
            href={`/deep-dive/${entry.sourceDeepDiveId}`}
            className="text-neuron-accent3 hover:underline"
          >
            from this cycle's deep dive →
          </Link>
        )}
      </div>

      <p className="mb-3 text-sm leading-relaxed text-neuron-text/90">{entry.promptContent}</p>

      <div className="space-y-2">
        {entry.options.map((option, i) => {
          const isSelected = selected === i;
          const isCorrect = i === entry.correctOption;
          const showState = selected !== null;
          let style = "border-neuron-border hover:border-neuron-accent3";
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
        <p className="mt-3 text-xs leading-relaxed text-neuron-muted">{entry.explanation}</p>
      )}
    </div>
  );
}

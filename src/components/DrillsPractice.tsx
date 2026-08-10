"use client";

import { useEffect, useState } from "react";
import { DrillCard } from "./DrillCard";
import type { DrillSummary } from "@/lib/digest";

export interface DrillWithInterest extends DrillSummary {
  interestName: string;
}

/** Drills' own dedicated space (Phase 8) — separate from the reading stream,
 * one question at a time. Same single-focus principle as the stream (no
 * auto-advance), just navigated on its own since drills are a denser,
 * more-interactive format. */
export function DrillsPractice({ drills }: { drills: DrillWithInterest[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.key === "ArrowRight" || e.key === "j" || e.key === "J") {
        setIndex((i) => Math.min(drills.length - 1, i + 1));
      } else if (e.key === "ArrowLeft" || e.key === "k" || e.key === "K") {
        setIndex((i) => Math.max(0, i - 1));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drills.length]);

  if (drills.length === 0) {
    return (
      <div className="card text-center">
        <p className="mb-1 text-lg font-medium">No drills yet</p>
        <p className="text-sm text-neuron-muted">
          Drills generate alongside this cycle's deep dives and Library chapters — check back after a
          refresh.
        </p>
      </div>
    );
  }

  const current = drills[Math.min(index, drills.length - 1)];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-xs text-neuron-muted">
        <span className="pill">{current.interestName}</span>
        <span>
          {index + 1} / {drills.length} · ←→ or j·k
        </span>
      </div>
      <DrillCard key={current.id} entry={current} />
      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
        >
          ← Prev
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => setIndex((i) => Math.min(drills.length - 1, i + 1))}
          disabled={index === drills.length - 1}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

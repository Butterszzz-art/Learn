"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function BrainGamesToggle({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [includeBrainGames, setIncludeBrainGames] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    const next = !includeBrainGames;
    setIncludeBrainGames(next);
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeBrainGames: next }),
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={includeBrainGames}
          onChange={toggle}
          disabled={saving}
          className="mt-1 h-4 w-4 rounded border-neuron-border bg-neuron-surface2 accent-neuron-accent"
        />
        <div>
          <p className="font-medium">🎮 Include brain games</p>
          <p className="mt-0.5 text-xs text-neuron-muted">
            Opt-in, separate from your interests — quick pattern/memory/math/logic puzzles, purely for
            fun. Not framed as a subject to master, and not the same evidence tier as the content-grounded
            Drills: research on whether this style of game improves general thinking beyond the game
            itself is weak.
          </p>
        </div>
      </label>
    </div>
  );
}

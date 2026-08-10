"use client";

import { useState } from "react";
import type { BrainGameType } from "@/db/schema";
import type { BrainGamePick } from "@/lib/brainGames";

const GAME_TYPE_LABELS: Record<BrainGameType, string> = {
  pattern_completion: "Pattern",
  working_memory_span: "Memory",
  quick_math: "Quick math",
  mini_logic_puzzle: "Logic puzzle",
};

/** Opt-in "for fun" card — see the honesty note below. Self-checked (reveal
 * the answer), no scoring. Phase 8 renders these as individual stream cards
 * rather than a grouped section (see former BrainGamesSection.tsx). */
export function BrainGameCard({ game }: { game: BrainGamePick }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="card">
      <div className="mb-2 flex items-center gap-2">
        <span className="pill">🎮 {GAME_TYPE_LABELS[game.gameType]}</span>
      </div>
      <p className="mb-3 text-xs text-neuron-muted">
        For fun, not a training regimen — evidence that this style of game improves general thinking
        beyond the game itself is weak. Treat it as a break, same evidence tier as a crossword.
      </p>
      <p className="mb-3 text-sm leading-relaxed text-neuron-text/90">{game.content}</p>
      {!revealed ? (
        <button type="button" className="btn-secondary text-xs" onClick={() => setRevealed(true)}>
          Reveal answer
        </button>
      ) : (
        <p className="text-xs leading-relaxed text-neuron-accent3">{game.answer}</p>
      )}
    </div>
  );
}

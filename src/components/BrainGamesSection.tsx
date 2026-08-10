"use client";

import { useState } from "react";
import type { BrainGameType } from "@/db/schema";

interface BrainGamePick {
  id: number;
  gameType: BrainGameType;
  content: string;
  answer: string;
}

const GAME_TYPE_LABELS: Record<BrainGameType, string> = {
  pattern_completion: "Pattern",
  working_memory_span: "Memory",
  quick_math: "Quick math",
  mini_logic_puzzle: "Logic puzzle",
};

/** Opt-in "for fun" section, separate from the interests feed — see the
 * honesty note below. Self-checked (reveal the answer), no scoring. */
export function BrainGamesSection({ games }: { games: BrainGamePick[] }) {
  if (games.length === 0) return null;

  return (
    <section className="mb-10">
      <h2 className="mb-1 font-display text-xl font-semibold">🎮 Brain Games</h2>
      <p className="mb-4 text-xs text-neuron-muted">
        For fun, not a training regimen — evidence that this style of game improves general thinking
        beyond the game itself is weak. Treat it as a break, same evidence tier as a crossword.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {games.map((game) => (
          <BrainGameCard key={game.id} game={game} />
        ))}
      </div>
    </section>
  );
}

function BrainGameCard({ game }: { game: BrainGamePick }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="card">
      <span className="pill mb-2 inline-block">{GAME_TYPE_LABELS[game.gameType]}</span>
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

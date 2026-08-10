"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RabbitHoleOfTheDay } from "@/lib/digest";

/** Once per cycle: one item entirely outside the reader's active interests
 * — visually distinct, clearly labeled, with a one-click "follow up on
 * this" action that adds it as a real (enabled) custom interest. */
export function RabbitHoleCard({ entry }: { entry: RabbitHoleOfTheDay }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addAsInterest() {
    setAdding(true);
    setError(null);
    try {
      const createRes = await fetch("/api/interests/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: entry.topicArea }),
      });
      const created = await createRes.json().catch(() => null);
      if (!createRes.ok) throw new Error(created?.error ?? "Couldn't add interest");

      const enableRes = await fetch("/api/interests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interests: [{ interestId: created.id, level: "some_background", enabled: true }] }),
      });
      if (!enableRes.ok) throw new Error("Interest was created but couldn't be enabled — check Settings.");

      setAdded(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="card mb-8 border-neuron-accent2/40 bg-gradient-to-br from-neuron-surface to-neuron-surface2">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-lg">🕳️</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-neuron-accent2">
          Rabbit Hole of the Day — outside your interests
        </span>
        <span className="pill">{entry.topicArea}</span>
      </div>
      <h3 className="mb-1 font-display text-lg font-semibold leading-snug">
        <a href={entry.url} target="_blank" rel="noopener noreferrer" className="hover:text-neuron-accent2">
          {entry.title}
        </a>
      </h3>
      <p className="mb-3 text-sm leading-relaxed text-neuron-text/90">{entry.summary}</p>
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={entry.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-neuron-accent2 hover:underline"
        >
          Read more ({entry.sourceName}) →
        </a>
        {added ? (
          <span className="text-xs text-neuron-muted">✓ Added as an interest</span>
        ) : (
          <button type="button" className="btn-secondary text-xs" onClick={addAsInterest} disabled={adding}>
            {adding ? "Adding…" : `+ Follow up on "${entry.topicArea}"`}
          </button>
        )}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}

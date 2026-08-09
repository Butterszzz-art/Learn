"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface FollowUpTopic {
  topic: string;
  teaser: string;
}

/** Curiosity branching: clickable follow-up cards at the end of a deep
 * dive's reading view. Clicking one generates that specific topic
 * immediately (not waiting for the next cycle) and navigates to it once
 * ready. Works for any interest — branching isn't a Passion Mode feature. */
export function FollowUpCards({
  interestId,
  topics,
}: {
  interestId: number;
  topics: FollowUpTopic[];
}) {
  const router = useRouter();
  const [loadingTopic, setLoadingTopic] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (topics.length === 0) return null;

  async function handleClick(topic: string) {
    setLoadingTopic(topic);
    setError(null);
    try {
      const res = await fetch("/api/deep-dive/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interestId, forcedTopic: topic }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Generation failed");
      if (!data?.deepDiveId) throw new Error("No API key configured, or generation didn't return a result.");
      router.push(`/deep-dive/${data.deepDiveId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoadingTopic(null);
    }
  }

  return (
    <div className="mt-10 border-t border-neuron-border pt-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neuron-muted">
        Keep going →
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {topics.map((t) => {
          const isLoading = loadingTopic === t.topic;
          return (
            <button
              key={t.topic}
              type="button"
              onClick={() => handleClick(t.topic)}
              disabled={loadingTopic !== null}
              className="card block text-left transition hover:-translate-y-0.5 hover:border-neuron-accent2 hover:shadow-xl hover:shadow-neuron-accent2/10 disabled:opacity-60 disabled:hover:translate-y-0"
            >
              <p className="mb-1 font-display text-base leading-snug">{t.topic}</p>
              <p className="text-xs leading-relaxed text-neuron-muted">{t.teaser}</p>
              {isLoading && (
                <p className="mt-2 text-xs text-neuron-accent2">Researching and writing this now…</p>
              )}
            </button>
          );
        })}
      </div>
      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
    </div>
  );
}

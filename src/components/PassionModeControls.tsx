"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Candidate {
  topic: string;
  teaser: string;
}

/** Passion Mode's on-demand controls, shown on favorited interests in the
 * feed: Binge (algorithm picks, generates immediately) and pick-your-next-
 * topic (surfaces candidates, reader picks). Both land as an extra deep dive
 * in this cycle's section once generation finishes — router.refresh() picks
 * it up rather than navigating away. */
export function PassionModeControls({ interestId }: { interestId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate(forcedTopic?: string) {
    setBusy(true);
    setCandidates(null);
    setError(null);
    try {
      const res = await fetch("/api/deep-dive/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interestId, forcedTopic }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Generation failed");
      if (!data?.added) throw new Error("No API key configured, or generation didn't return a result.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function loadCandidates() {
    setLoadingCandidates(true);
    setError(null);
    try {
      const res = await fetch("/api/deep-dive/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interestId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't load candidate topics");
      setCandidates(data?.candidates ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoadingCandidates(false);
    }
  }

  const disabled = busy || loadingCandidates;

  return (
    <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs">
      <p className="mb-2 font-semibold uppercase tracking-wide text-amber-300">⭐ Passion Mode</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => generate()} disabled={disabled}>
          {busy && !candidates ? "Generating…" : "🔥 Binge another deep dive"}
        </button>
        <button type="button" className="btn-secondary" onClick={loadCandidates} disabled={disabled}>
          {loadingCandidates ? "Loading topics…" : "🎯 Pick your next topic"}
        </button>
      </div>

      {candidates && candidates.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {candidates.map((c) => (
            <button
              key={c.topic}
              type="button"
              onClick={() => generate(c.topic)}
              disabled={busy}
              className="block w-full rounded-lg border border-brain-border bg-brain-surface2 p-2 text-left transition hover:border-amber-400/50 disabled:opacity-50"
            >
              <span className="font-medium text-brain-text">{c.topic}</span>
              <span className="block text-brain-muted">{c.teaser}</span>
            </button>
          ))}
        </div>
      )}
      {candidates && candidates.length === 0 && (
        <p className="mt-2 text-brain-muted">No candidate topics came back — try again in a moment.</p>
      )}
      {error && <p className="mt-2 text-red-400">{error}</p>}
    </div>
  );
}

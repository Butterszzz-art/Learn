"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface InterestProgress {
  id: number;
  name: string;
  status: "waiting" | "news" | "deep-dive" | "insight" | "done" | "error";
}

async function postStep(path: string, interestId: number): Promise<any> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ interestId }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `${path} failed`);
  return data;
}

// Passion Mode's per-cycle quota (FAVORITE_DEEP_DIVE_QUOTA in pipeline.ts)
// is currently 2, but this loop doesn't need to know the exact number: each
// call is a safe no-op once the server-side quota is reached, so looping up
// to this safety cap converges correctly for both favorited (quota 2) and
// regular (quota 1) interests without coupling the two constants together.
const MAX_DIVES_PER_INTEREST = 3;

/** Runs News -> Deep Dive(s) -> Applied Insight for one interest, sequentially, updating progress as it goes. */
async function runInterest(
  id: number,
  onStatus: (status: InterestProgress["status"]) => void
): Promise<{ newsAdded: number; deepDiveAdded: boolean; insightAdded: boolean }> {
  onStatus("news");
  const news = await postStep("/api/refresh/news", id).catch((err) => {
    console.error(err);
    return { added: 0 };
  });

  onStatus("deep-dive");
  let deepDiveAdded = false;
  for (let i = 0; i < MAX_DIVES_PER_INTEREST; i++) {
    const dive: { added?: boolean } = await postStep("/api/refresh/deep-dive", id).catch((err) => {
      console.error(err);
      return { added: false };
    });
    if (dive.added) deepDiveAdded = true;
    else break;
  }

  onStatus("insight");
  const insight = await postStep("/api/refresh/insight", id).catch((err) => {
    console.error(err);
    return { added: false };
  });

  onStatus("done");
  return { newsAdded: news.added ?? 0, deepDiveAdded, insightAdded: !!insight.added };
}

export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<InterestProgress[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setSummary(null);
    setLoading(true);

    try {
      const interestsRes = await fetch("/api/interests");
      const allInterests = await interestsRes.json();
      const enabled = (allInterests as any[]).filter((i) => i.enabled);

      if (enabled.length === 0) {
        setSummary("No interests enabled yet — check Settings.");
        setLoading(false);
        return;
      }

      setProgress(enabled.map((i) => ({ id: i.id, name: i.name, status: "waiting" as const })));

      const results = await Promise.all(
        enabled.map((i) =>
          runInterest(i.id, (status) => {
            setProgress((prev) => prev.map((p) => (p.id === i.id ? { ...p, status } : p)));
          }).catch((err) => {
            console.error(err);
            setProgress((prev) => prev.map((p) => (p.id === i.id ? { ...p, status: "error" } : p)));
            return { newsAdded: 0, deepDiveAdded: false, insightAdded: false };
          })
        )
      );

      const newsAdded = results.reduce((sum, r) => sum + r.newsAdded, 0);
      const deepDivesAdded = results.filter((r) => r.deepDiveAdded).length;
      const insightsAdded = results.filter((r) => r.insightAdded).length;
      const parts = [`+${newsAdded} news`, `+${deepDivesAdded} deep dives`];
      if (insightsAdded > 0) parts.push(`+${insightsAdded} insights`);
      setSummary(parts.join(", ") + ".");

      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
      setTimeout(() => setProgress([]), 2000);
    }
  }

  const busy = loading || isPending;

  return (
    <div className="flex flex-col items-end gap-2">
      <button className="btn-primary" onClick={handleClick} disabled={busy}>
        {busy ? (
          <>
            <Spinner /> Refreshing…
          </>
        ) : (
          <>↻ Refresh now</>
        )}
      </button>

      {progress.length > 0 && (
        <ul className="w-56 space-y-1 text-right text-xs text-brain-muted">
          {progress.map((p) => (
            <li key={p.id} className="flex items-center justify-end gap-1.5">
              <span>{p.name}</span>
              <StatusBadge status={p.status} />
            </li>
          ))}
        </ul>
      )}

      {summary && <p className="max-w-xs text-right text-xs text-brain-muted">{summary}</p>}
      {error && <p className="max-w-xs text-right text-xs text-red-400">{error}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: InterestProgress["status"] }) {
  const label: Record<InterestProgress["status"], string> = {
    waiting: "waiting…",
    news: "news…",
    "deep-dive": "deep dive…",
    insight: "insight…",
    done: "✓",
    error: "✕",
  };
  const color =
    status === "done" ? "text-green-400" : status === "error" ? "text-red-400" : "text-brain-accent";
  return <span className={color}>{label[status]}</span>;
}

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

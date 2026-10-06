"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PrunableContentType } from "@/db/schema";
import { CONTENT_TYPE_LABELS } from "@/lib/contentTypeLabels";

export interface PruningNoticeItem {
  interestId: number;
  interestName: string;
  contentType: PrunableContentType;
  switchedAt: string | null;
}

/**
 * Phase 14 — surfaces every (interest, content type) the pruning sweep
 * switched to on-demand, as a small dismissible note: "Drills for
 * Philosophy haven't been used recently, switched to on-demand." Two
 * actions: "Turn back on" (resumes auto-generation) and "Generate now"
 * (one immediate, synchronous generation without changing the mode).
 * Dismissing just hides the note; the content type stays on-demand.
 */
export function PruningNotices({ initial }: { initial: PruningNoticeItem[] }) {
  const router = useRouter();
  const [notices, setNotices] = useState(initial);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [genMessage, setGenMessage] = useState<Record<string, string>>({});

  if (notices.length === 0) return null;

  function key(n: PruningNoticeItem) {
    return `${n.interestId}:${n.contentType}`;
  }

  async function dismiss(n: PruningNoticeItem) {
    setNotices((prev) => prev.filter((x) => x !== n));
    await fetch("/api/prune/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interestId: n.interestId, contentType: n.contentType }),
    }).catch(() => {});
  }

  async function turnBackOn(n: PruningNoticeItem) {
    setBusyKey(key(n));
    try {
      await fetch("/api/prune/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interestId: n.interestId, contentType: n.contentType }),
      });
      setNotices((prev) => prev.filter((x) => x !== n));
      router.refresh();
    } finally {
      setBusyKey(null);
    }
  }

  async function generateNow(n: PruningNoticeItem) {
    setBusyKey(key(n));
    setGenMessage((prev) => ({ ...prev, [key(n)]: "" }));
    try {
      const res = await fetch("/api/prune/generate-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interestId: n.interestId, contentType: n.contentType }),
      });
      const data = await res.json().catch(() => null);
      setGenMessage((prev) => ({
        ...prev,
        [key(n)]: data?.added ? "Generated — check the feed." : data?.message || "Nothing generated this time.",
      }));
      if (data?.added) router.refresh();
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="mb-4 space-y-2">
      {notices.map((n) => (
        <div key={key(n)} className="card flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
          <div>
            <span>
              {CONTENT_TYPE_LABELS[n.contentType]} for <strong>{n.interestName}</strong> haven't been used
              recently, switched to on-demand.
            </span>
            {genMessage[key(n)] && <p className="mt-0.5 text-xs text-neuron-muted">{genMessage[key(n)]}</p>}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={busyKey === key(n)}
              onClick={() => generateNow(n)}
            >
              Generate now
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={busyKey === key(n)}
              onClick={() => turnBackOn(n)}
            >
              Turn back on
            </button>
            <button
              type="button"
              className="text-xs text-neuron-muted hover:text-neuron-text"
              onClick={() => dismiss(n)}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

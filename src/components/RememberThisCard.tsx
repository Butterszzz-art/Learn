"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DueReviewTopic } from "@/lib/digest";

/** Spaced resurfacing: one topic due for review, shown above the day's new
 * content. Shows a recall prompt first — deliberately not graded, just a
 * beat to try recalling before reveal — then a brief refresher from the
 * original deep dive on request. Revealing is what counts as "reviewed" and
 * pushes the next review date further out. */
export function RememberThisCard({ due }: { due: DueReviewTopic }) {
  const router = useRouter();
  const [revealed, setRevealed] = useState(false);

  async function reveal() {
    setRevealed(true);
    try {
      await fetch("/api/review/mark-viewed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coveredTopicId: due.coveredTopicId }),
      });
      router.refresh();
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="card mb-6 border-neuron-accent2/40 bg-gradient-to-br from-neuron-surface to-neuron-surface2">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neuron-accent2">
        🧠 Remember this?
      </p>
      <p className="mb-3 text-xs text-neuron-muted">
        {due.interestName} · covered {due.coveredDaysAgo === 0 ? "today" : `${due.coveredDaysAgo}d ago`}
      </p>
      <p className="mb-3 font-display text-lg leading-snug">{due.topic}</p>

      {!revealed ? (
        <button type="button" className="btn-secondary text-xs" onClick={reveal}>
          Try to recall it, then reveal →
        </button>
      ) : (
        <div className="space-y-3">
          {due.contentPreview ? (
            <p className="text-sm leading-relaxed text-neuron-text/90">{due.contentPreview}</p>
          ) : (
            <p className="text-sm text-neuron-muted">
              The original entry isn't available to preview, but you covered this one.
            </p>
          )}
          {due.deepDiveId && (
            <Link href={`/deep-dive/${due.deepDiveId}`} className="inline-block text-xs text-neuron-accent hover:underline">
              Read the full entry again →
            </Link>
          )}
          {due.chapterId && (
            <Link
              href={`/library/chapter/${due.chapterId}`}
              className="inline-block text-xs text-neuron-accent hover:underline"
            >
              Read the full chapter again →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import type { DeepDiveSummary } from "@/lib/digest";
import { LEVEL_LABELS } from "@/db/schema";

/** Deep Dives render as a hook within the stream — title + a strong opening
 * line, not the full content. Tapping opens the full reading view (including
 * explain-it-back); its "back to feed" link carries `next` so closing it
 * returns to the stream at the NEXT card, not this same hook again. */
export function StreamDeepDiveHookCard({
  entry,
  interestName,
  nextCardId,
}: {
  entry: DeepDiveSummary;
  interestName: string;
  nextCardId?: string;
}) {
  const opening = entry.contentPreview.split(/(?<=[.?!])\s+/)[0] || entry.contentPreview;
  const href = nextCardId
    ? `/deep-dive/${entry.id}?from=stream&next=${encodeURIComponent(nextCardId)}`
    : `/deep-dive/${entry.id}?from=stream`;

  return (
    <Link
      href={href}
      className="card block border-neuron-accent2/40 bg-gradient-to-br from-neuron-surface to-neuron-surface2 transition hover:-translate-y-1 hover:border-neuron-accent2 hover:shadow-xl hover:shadow-neuron-accent2/10"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="pill border-neuron-accent2/50 text-neuron-accent2">📖 Deep Dive</span>
        <span className="pill">{interestName}</span>
        <span className="pill">{LEVEL_LABELS[entry.level]}</span>
      </div>
      <h3 className="mb-2 font-display text-xl leading-snug">{entry.topic}</h3>
      <p className="text-sm leading-relaxed text-neuron-text/90">{opening}</p>
      <p className="mt-4 text-xs text-neuron-accent2">Read the full explainer →</p>
    </Link>
  );
}

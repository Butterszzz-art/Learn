import type { AppliedInsightSummary } from "@/lib/digest";

export function AppliedInsightCard({
  entry,
  showLabel = true,
}: {
  entry: AppliedInsightSummary;
  /** Hide the internal 💡 label when the card already sits under an equivalent section heading. */
  showLabel?: boolean;
}) {
  return (
    <div className="card border-amber-400/30 bg-gradient-to-br from-neuron-surface to-neuron-surface2">
      {showLabel && (
        <div className="mb-2 flex items-center gap-2">
          <span className="text-lg">💡</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-amber-300">
            Applied Insight
          </span>
        </div>
      )}
      <p className="text-sm leading-relaxed text-neuron-text/90">{entry.content}</p>
    </div>
  );
}

import type { AppliedInsightSummary } from "@/lib/digest";

export function AppliedInsightCard({ entry }: { entry: AppliedInsightSummary }) {
  return (
    <div className="card border-amber-400/30 bg-gradient-to-br from-brain-surface to-brain-surface2">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-lg">💡</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-amber-300">
          Applied Insight
        </span>
      </div>
      <p className="text-sm leading-relaxed text-brain-text/90">{entry.content}</p>
    </div>
  );
}

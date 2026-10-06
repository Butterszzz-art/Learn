/** Phase 13 — marks the start of one interest's weekly deep-content bundle
 * in the stream: "This Week in [Interest]", plus how many items follow.
 * Purely a section marker (not a link, nothing to interact with) — the
 * actual content is the deepDiveHook/appliedInsight cards right after it. */
export function WeeklyBundleHeaderCard({ interestName, count }: { interestName: string; count: number }) {
  return (
    <div className="card border-neuron-accent2/40 bg-gradient-to-br from-neuron-surface to-neuron-surface2 text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-neuron-accent2">This Week in</p>
      <p className="mt-1 font-display text-xl font-bold">{interestName}</p>
      <p className="mt-2 text-xs text-neuron-muted">
        {count} item{count === 1 ? "" : "s"} in this week's bundle
      </p>
    </div>
  );
}

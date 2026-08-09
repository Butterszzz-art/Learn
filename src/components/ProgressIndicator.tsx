// Plain, non-punitive progress count. Deliberately NOT a day-streak or any
// framing that creates pressure/guilt around a gap — just an informational
// count of concepts covered. No "at risk" state, ever.
export function ProgressIndicator({
  conceptsThisMonth,
  interestsCount,
}: {
  conceptsThisMonth: number;
  interestsCount: number;
}) {
  if (conceptsThisMonth === 0) return null;

  return (
    <p className="text-xs text-brain-muted">
      📈 {conceptsThisMonth} concept{conceptsThisMonth === 1 ? "" : "s"} covered this month across{" "}
      {interestsCount} interest{interestsCount === 1 ? "" : "s"}.
    </p>
  );
}

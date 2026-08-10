import { ProgressIndicator } from "./ProgressIndicator";

/** The stream's terminal card — no infinite backfill, deliberately. Carries
 * the plain, non-streak progress count from Phase 4 (see ProgressIndicator). */
export function CaughtUpCard({
  conceptsThisMonth,
  interestsCount,
  frequency,
}: {
  conceptsThisMonth: number;
  interestsCount: number;
  frequency: string;
}) {
  return (
    <div className="card border-neuron-border text-center">
      <p className="mb-2 text-lg font-medium">✓ You're caught up</p>
      <p className="mb-4 text-sm text-neuron-muted">
        That's everything for this {frequency === "daily" ? "day" : "week"}'s cycle. Refresh for new
        news items — deep dives and insights regenerate next cycle.
      </p>
      <ProgressIndicator conceptsThisMonth={conceptsThisMonth} interestsCount={interestsCount} />
    </div>
  );
}

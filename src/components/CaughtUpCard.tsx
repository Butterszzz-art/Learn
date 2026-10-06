import { ProgressIndicator } from "./ProgressIndicator";

/** The stream's terminal card — no infinite backfill, deliberately. Carries
 * the plain, non-streak progress count from Phase 4 (see ProgressIndicator).
 * Phase 13: the cadence-aware copy is precomputed server-side (see
 * caughtUpMessage in stream.ts) rather than branched here, since "caught up"
 * now depends on two independent cadences (today's headlines, this week's
 * deep-content bundle) instead of one. */
export function CaughtUpCard({
  conceptsThisMonth,
  interestsCount,
  message,
}: {
  conceptsThisMonth: number;
  interestsCount: number;
  message: string;
}) {
  return (
    <div className="card border-neuron-border text-center">
      <p className="mb-2 text-lg font-medium">✓ You're caught up</p>
      <p className="mb-4 text-sm text-neuron-muted">{message}</p>
      <ProgressIndicator conceptsThisMonth={conceptsThisMonth} interestsCount={interestsCount} />
    </div>
  );
}

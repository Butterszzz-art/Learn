import { getEnabledInterests } from "@/lib/interests";
import { getCurrentWeeklyFeed } from "@/lib/digest";
import { DrillsPractice, type DrillWithInterest } from "@/components/DrillsPractice";

export const dynamic = "force-dynamic";

/** Drills' own dedicated tab (Phase 8) — pulled out of the reading stream.
 * Reuses the same cycle content the stream and old Feed drew from; nothing
 * new is generated here. Phase 13: Drills moved to weekly cadence, so this
 * reads the current WEEKLY cycle specifically (not "whatever cycle was most
 * recently created", which could just as easily be today's daily one). */
export default async function DrillsPage() {
  const enabledInterests = await getEnabledInterests();
  const feed = await getCurrentWeeklyFeed(enabledInterests.map((i) => i.id));

  const drills: DrillWithInterest[] = feed
    ? feed.sections.flatMap((s) => s.drills.map((d) => ({ ...d, interestName: s.interestName })))
    : [];

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-bold">🧩 Drills</h1>
      <p className="mb-6 text-xs text-neuron-muted">
        This week's grounded and standalone drills, one question at a time.
      </p>
      <DrillsPractice drills={drills} />
    </div>
  );
}

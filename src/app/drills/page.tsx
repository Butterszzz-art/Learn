import { getEnabledInterests } from "@/lib/interests";
import { getCurrentFeed } from "@/lib/digest";
import { DrillsPractice, type DrillWithInterest } from "@/components/DrillsPractice";

export const dynamic = "force-dynamic";

/** Drills' own dedicated tab (Phase 8) — pulled out of the reading stream.
 * Reuses the same cycle content the stream and old Feed drew from; nothing
 * new is generated here. */
export default async function DrillsPage() {
  const enabledInterests = await getEnabledInterests();
  const feed = await getCurrentFeed(enabledInterests.map((i) => i.id));

  const drills: DrillWithInterest[] = feed
    ? feed.sections.flatMap((s) => s.drills.map((d) => ({ ...d, interestName: s.interestName })))
    : [];

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-bold">🧩 Drills</h1>
      <p className="mb-6 text-xs text-neuron-muted">
        This cycle's grounded and standalone drills, one question at a time.
      </p>
      <DrillsPractice drills={drills} />
    </div>
  );
}

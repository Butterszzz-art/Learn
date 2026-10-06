import { redirect } from "next/navigation";
import Link from "next/link";
import { hasCompletedOnboarding, getEnabledInterests } from "@/lib/interests";
import { getHybridCurrentFeed } from "@/lib/digest";
import { buildReadingStream, computeHiddenCardIds } from "@/lib/stream";
import { StreamContainer } from "@/components/stream/StreamContainer";
import { RefreshButton } from "@/components/RefreshButton";
import { hasClaudeKey } from "@/lib/claude";
import { getActivePruningNotices } from "@/lib/engagement";
import { PruningNotices } from "@/components/PruningNotices";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: { at?: string } }) {
  const onboarded = await hasCompletedOnboarding();
  if (!onboarded) redirect("/onboarding");

  const enabledInterests = await getEnabledInterests();
  const feed = await getHybridCurrentFeed(enabledInterests.map((i) => i.id));
  const claudeConfigured = hasClaudeKey();
  const pruningNotices = await getActivePruningNotices();

  const cards = feed ? buildReadingStream(feed, false, feed) : [];
  const hiddenCardIds = feed ? [...computeHiddenCardIds(cards, feed)] : [];

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="max-w-md">
          {!claudeConfigured && (
            <p className="mb-2 text-xs text-neuron-muted">
              No <code>ANTHROPIC_API_KEY</code> set — deep dives are skipped; curated items still
              work. See the README to enable them.
            </p>
          )}
          <Link href="/settings" className="text-xs text-neuron-muted hover:text-neuron-text">
            {enabledInterests.length} interest{enabledInterests.length === 1 ? "" : "s"} enabled · edit
            in Settings →
          </Link>
        </div>
        <RefreshButton />
      </div>

      <PruningNotices initial={pruningNotices} />

      {feed ? (
        <StreamContainer
          cards={cards}
          interestPills={feed.sections.map((s) => ({ id: s.interestId, name: s.interestName, isFavorite: s.isFavorite }))}
          periodLabel={combinedPeriodLabel(feed.dailyPeriodLabel, feed.weeklyPeriodLabel)}
          frequency="hybrid"
          totalEntries={feed.totalEntries}
          createdLabel={formatCreatedLabel(feed.createdAt)}
          initialCardId={searchParams.at}
          hiddenCardIds={hiddenCardIds}
        />
      ) : (
        <div className="card text-center">
          <p className="mb-2 text-lg font-medium">No cycle yet</p>
          <p className="text-sm text-neuron-muted">
            Click "Refresh now" to fetch curated items and generate your first deep dives.
          </p>
        </div>
      )}
    </div>
  );
}

function formatCreatedLabel(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** "Tue, Aug 11 · Week of Aug 10" — the header combines both cadences'
 * period labels (Phase 13), since a single feed no longer has just one. */
function combinedPeriodLabel(dailyLabel: string, weeklyLabel: string): string {
  const daily = new Date(`${dailyLabel}T00:00:00Z`);
  const dailyText = isNaN(daily.getTime())
    ? dailyLabel
    : daily.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  // "Week of 2026-08-10" -> "Week of Aug 10"
  const weeklyText = weeklyLabel.replace(/(\d{4})-(\d{2})-(\d{2})/, (_m, y, mo, d) => {
    const date = new Date(`${y}-${mo}-${d}T00:00:00Z`);
    return isNaN(date.getTime())
      ? `${y}-${mo}-${d}`
      : date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  });
  if (!dailyLabel) return weeklyText;
  if (!weeklyLabel) return dailyText;
  return `${dailyText} · ${weeklyText}`;
}

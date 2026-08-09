import type { CycleFeed, InterestFeedSection } from "@/lib/digest";
import { BrainFactCard } from "./BrainFactCard";
import { DeepDiveCard } from "./DeepDiveCard";
import { AppliedInsightCard } from "./AppliedInsightCard";
import { ItemCard } from "./ItemCard";
import { FavoriteToggle } from "./FavoriteToggle";
import { PassionModeControls } from "./PassionModeControls";
import { RememberThisCard } from "./RememberThisCard";
import { ProgressIndicator } from "./ProgressIndicator";

function InterestSection({ section }: { section: InterestFeedSection }) {
  const hasContent =
    section.news.length > 0 || section.deepDives.length > 0 || section.appliedInsights.length > 0;
  if (!hasContent) return null;

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="font-display text-xl font-semibold">{section.interestName}</h2>
        <FavoriteToggle interestId={section.interestId} isFavorite={section.isFavorite} />
      </div>

      {section.news.length > 0 && (
        <div className="mb-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neuron-muted">
            📰 News
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {section.news.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}

      {section.deepDives.length > 0 && (
        <div className="mb-5 space-y-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neuron-muted">
            📖 Deep Dive{section.deepDives.length > 1 ? "s" : ""}
          </h3>
          {section.deepDives.map((dive) => (
            <DeepDiveCard key={dive.id} entry={dive} />
          ))}
        </div>
      )}

      {section.appliedInsights.length > 0 && (
        <div className={section.isFavorite ? "" : "mb-5"}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neuron-muted">
            💡 Applied Insight{section.appliedInsights.length > 1 ? "s" : ""}
          </h3>
          <div className="space-y-3">
            {section.appliedInsights.map((insight) => (
              <AppliedInsightCard key={insight.id} entry={insight} showLabel={false} />
            ))}
          </div>
        </div>
      )}

      {section.isFavorite && <PassionModeControls interestId={section.interestId} />}
    </section>
  );
}

export function Feed({ feed, isArchive = false }: { feed: CycleFeed; isArchive?: boolean }) {
  const createdAt = new Date(feed.createdAt);
  const createdLabel = isNaN(createdAt.getTime())
    ? ""
    : createdAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold">{feed.periodLabel}</h1>
        <p className="text-xs text-neuron-muted">
          {feed.frequency} cycle · {feed.totalEntries} items · last updated {createdLabel}
        </p>
        {!isArchive && (
          <div className="mt-1">
            <ProgressIndicator
              conceptsThisMonth={feed.progress.conceptsThisMonth}
              interestsCount={feed.progress.interestsCount}
            />
          </div>
        )}
      </div>

      {!isArchive && feed.dueReview && <RememberThisCard due={feed.dueReview} />}

      {feed.showBrainFact && feed.brainFact && (
        <div className="mb-8">
          <BrainFactCard fact={feed.brainFact} />
        </div>
      )}

      {feed.sections.length === 0 ? (
        <div className="card text-center">
          <p className="mb-1 text-lg font-medium">Nothing here yet</p>
          <p className="text-sm text-neuron-muted">
            Click "Refresh now" to fetch news and generate deep dives for this cycle.
          </p>
        </div>
      ) : (
        feed.sections.map((section) => <InterestSection key={section.interestId} section={section} />)
      )}

      {feed.totalEntries > 0 && (
        <div className="mt-10 border-t border-neuron-border pt-6 text-center">
          <p className="text-sm font-medium">✓ You're caught up</p>
          <p className="mt-1 text-xs text-neuron-muted">
            That's everything for this {feed.frequency === "daily" ? "day" : "week"}'s cycle. Refresh
            for new news items — deep dives and insights regenerate next cycle.
          </p>
        </div>
      )}
    </div>
  );
}

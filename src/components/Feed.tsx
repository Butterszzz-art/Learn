import type { CycleFeed, InterestFeedSection } from "@/lib/digest";
import { BrainFactCard } from "./BrainFactCard";
import { DeepDiveCard } from "./DeepDiveCard";
import { AppliedInsightCard } from "./AppliedInsightCard";
import { ItemCard } from "./ItemCard";

function InterestSection({ section }: { section: InterestFeedSection }) {
  const hasContent = section.news.length > 0 || section.deepDive || section.appliedInsight;
  if (!hasContent) return null;

  return (
    <section className="mb-10">
      <h2 className="mb-4 font-serif text-xl">{section.interestName}</h2>

      {section.news.length > 0 && (
        <div className="mb-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brain-muted">
            📰 News
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {section.news.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}

      {section.deepDive && (
        <div className="mb-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brain-muted">
            📖 Deep Dive
          </h3>
          <DeepDiveCard entry={section.deepDive} />
        </div>
      )}

      {section.appliedInsight && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brain-muted">
            💡 Applied Insight
          </h3>
          <AppliedInsightCard entry={section.appliedInsight} />
        </div>
      )}
    </section>
  );
}

export function Feed({ feed }: { feed: CycleFeed }) {
  const createdAt = new Date(feed.createdAt);
  const createdLabel = isNaN(createdAt.getTime())
    ? ""
    : createdAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-serif text-2xl">{feed.periodLabel}</h1>
        <p className="text-xs text-brain-muted">
          {feed.frequency} cycle · {feed.totalEntries} items · last updated {createdLabel}
        </p>
      </div>

      {feed.showBrainFact && feed.brainFact && (
        <div className="mb-8">
          <BrainFactCard fact={feed.brainFact} />
        </div>
      )}

      {feed.sections.length === 0 ? (
        <div className="card text-center">
          <p className="mb-1 text-lg font-medium">Nothing here yet</p>
          <p className="text-sm text-brain-muted">
            Click "Refresh now" to fetch news and generate deep dives for this cycle.
          </p>
        </div>
      ) : (
        feed.sections.map((section) => <InterestSection key={section.interestId} section={section} />)
      )}

      {feed.totalEntries > 0 && (
        <div className="mt-10 border-t border-brain-border pt-6 text-center">
          <p className="text-sm font-medium">✓ You're caught up</p>
          <p className="mt-1 text-xs text-brain-muted">
            That's everything for this {feed.frequency === "daily" ? "day" : "week"}'s cycle. Refresh
            for new news items — deep dives and insights regenerate next cycle.
          </p>
        </div>
      )}
    </div>
  );
}

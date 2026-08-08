import type { CycleFeed } from "@/lib/digest";
import { BrainFactCard } from "./BrainFactCard";
import { DeepDiveCard } from "./DeepDiveCard";
import { ItemCard } from "./ItemCard";

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
          {feed.frequency} cycle · {feed.entries.length} items · last updated {createdLabel}
        </p>
      </div>

      {feed.showBrainFact && feed.brainFact && (
        <div className="mb-8">
          <BrainFactCard fact={feed.brainFact} />
        </div>
      )}

      {feed.entries.length === 0 ? (
        <div className="card text-center">
          <p className="mb-1 text-lg font-medium">Nothing here yet</p>
          <p className="text-sm text-brain-muted">
            Click "Refresh now" to fetch curated items and generate deep dives for this cycle.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {feed.entries.map((entry) =>
            entry.type === "deepdive" ? (
              <DeepDiveCard key={`dd-${entry.id}`} entry={entry} />
            ) : (
              <ItemCard key={`item-${entry.id}`} item={entry} />
            )
          )}
        </div>
      )}

      {feed.entries.length > 0 && (
        <div className="mt-10 border-t border-brain-border pt-6 text-center">
          <p className="text-sm font-medium">✓ You're caught up</p>
          <p className="mt-1 text-xs text-brain-muted">
            That's everything for this {feed.frequency === "daily" ? "day" : "week"}'s cycle. Refresh
            for new curated items — deep dives regenerate next cycle.
          </p>
        </div>
      )}
    </div>
  );
}

import type { DigestView as DigestViewType } from "@/lib/digest";
import { BrainFactCard } from "./BrainFactCard";
import { CategorySection } from "./CategorySection";

export function DigestView({ digest }: { digest: DigestViewType }) {
  const createdAt = new Date(digest.createdAt);
  const createdLabel = isNaN(createdAt.getTime())
    ? ""
    : createdAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl">{digest.periodLabel}</h1>
          <p className="text-xs text-brain-muted">
            {digest.frequency} digest · {digest.totalItems} items · compiled {createdLabel}
          </p>
        </div>
      </div>

      <div className="mb-10">
        <BrainFactCard fact={digest.brainFact} />
      </div>

      {digest.itemsByCategory.length === 0 ? (
        <p className="text-sm text-brain-muted">No items in this digest.</p>
      ) : (
        digest.itemsByCategory.map(({ category, items }) => (
          <CategorySection key={category} category={category} items={items} />
        ))
      )}
    </div>
  );
}

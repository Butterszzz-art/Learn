import type { Category } from "@/db/schema";
import type { DigestItem } from "@/lib/digest";
import { ItemCard } from "./ItemCard";

const CATEGORY_ICON: Record<Category, string> = {
  "Computational Neuroscience": "🧮",
  "Quantum Biology": "⚛️",
  "Behavioral Neuroscience": "🐭",
  "General Neuroscience & Psychobiology": "🧠",
};

export function CategorySection({ category, items }: { category: Category; items: DigestItem[] }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <span>{CATEGORY_ICON[category]}</span>
        {category}
        <span className="text-sm font-normal text-brain-muted">({items.length})</span>
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

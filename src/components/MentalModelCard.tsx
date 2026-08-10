import type { MentalModelOfTheDay } from "@/lib/digest";

/** Once per cycle: one mental model connected concretely to one or two of
 * today's actual items, ideally from different interests — visually
 * distinct from the per-interest sections. */
export function MentalModelCard({ entry }: { entry: MentalModelOfTheDay }) {
  return (
    <div className="card mb-8 border-neuron-accent3/40 bg-gradient-to-br from-neuron-surface to-neuron-surface2">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-lg">🔎</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-neuron-accent3">
          Mental Model of the Day
        </span>
        <span className="pill">{entry.category}</span>
      </div>
      <p className="mb-2 font-display text-lg font-semibold">{entry.modelName}</p>
      <p className="mb-3 text-sm leading-relaxed text-neuron-text/90">{entry.lensText}</p>
      {entry.linkedItems.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {entry.linkedItems.map((item) => (
            <span key={item.id} className="pill">
              {item.interestName}: {item.title}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

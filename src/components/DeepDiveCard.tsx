import Link from "next/link";
import type { DeepDiveSummary } from "@/lib/digest";
import { LEVEL_LABELS } from "@/db/schema";

export function DeepDiveCard({ entry }: { entry: DeepDiveSummary }) {
  return (
    <Link
      href={`/deep-dive/${entry.id}`}
      className="card block border-neuron-accent2/40 bg-gradient-to-br from-neuron-surface to-neuron-surface2 transition hover:-translate-y-1 hover:border-neuron-accent2 hover:shadow-xl hover:shadow-neuron-accent2/10"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="pill">{LEVEL_LABELS[entry.level]}</span>
      </div>
      <h3 className="mb-2 font-display text-lg leading-snug">{entry.topic}</h3>
      <p className="text-sm leading-relaxed text-neuron-text/90">{entry.contentPreview}</p>
      <p className="mt-3 text-xs text-neuron-accent2">
        Read the full explainer{entry.sourceCount > 0 ? ` · ${entry.sourceCount} sources` : ""} →
      </p>
    </Link>
  );
}

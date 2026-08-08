import Link from "next/link";
import type { DeepDiveSummary } from "@/lib/digest";
import { LEVEL_LABELS } from "@/db/schema";

export function DeepDiveCard({ entry }: { entry: DeepDiveSummary }) {
  return (
    <Link
      href={`/deep-dive/${entry.id}`}
      className="card block border-brain-accent2/40 bg-gradient-to-br from-brain-surface to-brain-surface2 transition hover:border-brain-accent2"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="pill">{LEVEL_LABELS[entry.level]}</span>
      </div>
      <h3 className="mb-2 font-serif text-lg leading-snug">{entry.topic}</h3>
      <p className="text-sm leading-relaxed text-brain-text/90">{entry.contentPreview}</p>
      <p className="mt-3 text-xs text-brain-accent2">
        Read the full explainer{entry.sourceCount > 0 ? ` · ${entry.sourceCount} sources` : ""} →
      </p>
    </Link>
  );
}

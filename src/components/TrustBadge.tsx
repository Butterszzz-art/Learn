import type { SourceClassification } from "@/lib/trustSignals";
import { SYNTHESIZED_NOTE } from "@/lib/trustSignals";

/** Phase 15 — the visible half of the trust-signals transparency layer.
 * "Grounded" renders as a small pill (matching the sources list it usually
 * sits next to); "synthesized" renders as a plain, honest note rather than a
 * pill, so it reads as a caveat, not a badge of approval. */
export function TrustBadge({ classification }: { classification: SourceClassification }) {
  if (classification === "grounded") {
    return (
      <span
        className="pill border-emerald-500/40 text-emerald-400"
        title="Draws directly from a specific identifiable source"
      >
        ✓ Grounded
      </span>
    );
  }
  return <span className="text-[11px] italic text-neuron-muted">{SYNTHESIZED_NOTE}</span>;
}

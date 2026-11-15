import type { SourceClassification } from "@/lib/trustSignals";
import { SYNTHESIZED_NOTE } from "@/lib/trustSignals";

/** "Grounded" = drawn from specific cited sources; otherwise a plain note that it is general synthesis. */
export function TrustBadge({ classification }: { classification: SourceClassification }) {
  if (classification === "grounded") {
    return (
      <span className="pill !border-neuron-accent3/50 !bg-neuron-accent3/10 !text-neuron-accent3" title="Draws directly from specific, identifiable sources">
        ✓ Grounded in sources
      </span>
    );
  }
  return <span className="text-xs italic text-neuron-muted">{SYNTHESIZED_NOTE}</span>;
}

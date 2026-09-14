import { ResearchAgent } from "@/components/ResearchAgent";

export const dynamic = "force-dynamic";

/**
 * Research Agent (add-on feature) — its own dedicated tab, separate from the
 * "Search everything" overlay (Cmd/Ctrl+K), which only searches content this
 * app has already generated. This searches the live literature instead:
 * OpenAlex + Semantic Scholar, via an OpenRouter-backed agent. Independent
 * of the Anthropic key the rest of the app uses.
 */
export default function ResearchPage() {
  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-bold">🔬 Research Agent</h1>
      <p className="mb-6 text-xs text-neuron-muted">
        Ask a question and it searches OpenAlex + Semantic Scholar for real papers before
        answering, citing what it actually found.
      </p>
      <ResearchAgent />
    </div>
  );
}

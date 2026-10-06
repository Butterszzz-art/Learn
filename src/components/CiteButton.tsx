type CiteKind = "item" | "book" | "deep-dive";

/** Phase 15 (Citation Export) — plain anchor tags to the cite API route,
 * same "let the browser just download it" pattern as ExportButtons.tsx.
 * Only rendered on grounded items — see each call site. */
export function CiteButton({ kind, id }: { kind: CiteKind; id: number }) {
  const base = `/api/cite/${kind}/${id}`;
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <a href={`${base}?format=bib`} className="text-neuron-accent hover:underline">
        Cite (BibTeX)
      </a>
      <a href={`${base}?format=ris`} className="text-neuron-accent hover:underline">
        Cite (RIS)
      </a>
    </span>
  );
}

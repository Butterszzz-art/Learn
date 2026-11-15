type CiteKind = "item" | "book" | "deep-dive";

/** Download a citation (or, for a deep dive, its source list) as BibTeX or RIS. */
export function CiteButton({ kind, id, label = "Cite" }: { kind: CiteKind; id: number; label?: string }) {
  const base = `/api/cite/${kind}/${id}`;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="text-neuron-muted">{label}:</span>
      <a href={`${base}?format=bib`} className="font-bold text-neuron-accent">BibTeX</a>
      <a href={`${base}?format=ris`} className="font-bold text-neuron-accent">RIS</a>
    </span>
  );
}

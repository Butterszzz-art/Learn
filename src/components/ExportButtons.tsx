type ExportKind = "deep-dive" | "chapter" | "explain-back";

/** Export-as-markdown / export-as-PDF links for one item (Phase 11) — plain
 * anchor tags to the export API route, so the browser just downloads the
 * file natively rather than needing any client-side state. */
export function ExportButtons({ kind, id }: { kind: ExportKind; id: number }) {
  const base = `/api/export/${kind}/${id}`;
  return (
    <div className="flex items-center gap-3 text-xs">
      <a href={`${base}?format=md`} className="text-neuron-accent hover:underline">
        ⬇ Export as Markdown
      </a>
      <a href={`${base}?format=pdf`} className="text-neuron-accent hover:underline">
        ⬇ Export as PDF
      </a>
    </div>
  );
}

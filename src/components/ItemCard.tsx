import type { DigestItem } from "@/lib/digest";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function ItemCard({ item }: { item: DigestItem }) {
  return (
    <article className="card">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-brain-muted">
        <span className="pill">{item.sourceName}</span>
        {item.publishedAt && <span>{formatDate(item.publishedAt)}</span>}
        {item.sourceType === "academic" && <span className="pill">peer/preprint</span>}
      </div>
      <h3 className="mb-1 text-base font-semibold leading-snug">
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:text-brain-accent">
          {item.title}
        </a>
      </h3>
      {item.authors && <p className="mb-2 text-xs text-brain-muted">{item.authors}</p>}
      <p className="text-sm leading-relaxed text-brain-text/90">{item.summary}</p>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-block text-xs text-brain-accent hover:underline"
      >
        Read source →
      </a>
    </article>
  );
}

import type { NewsItem } from "@/lib/digest";
import { SteelmanToggle } from "./SteelmanToggle";
import { TrustBadge } from "./TrustBadge";
import { CiteButton } from "./CiteButton";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  // Fixed locale/timezone (not the runtime default) — this card now renders
  // inside the client-hydrated reading stream (Phase 8), not just server-
  // side, so an environment-dependent format here caused a real
  // server/client hydration mismatch (Node's vs. the browser's default
  // Intl locale disagreeing on date order).
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function ItemCard({ item, interestId }: { item: NewsItem; interestId?: number | null }) {
  return (
    <article className="card">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-neuron-muted">
        <span className="pill">{item.sourceName}</span>
        {item.category && <span className="pill">{item.category}</span>}
        {item.publishedAt && <span>{formatDate(item.publishedAt)}</span>}
        {item.sourceType === "academic" && <span className="pill">peer/preprint</span>}
        {item.sourceType === "generated" && <span className="pill">web search</span>}
      </div>
      <h3 className="mb-1 text-base font-semibold leading-snug">
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:text-neuron-accent">
          {item.title}
        </a>
      </h3>
      {item.authors && <p className="mb-2 text-xs text-neuron-muted">{item.authors}</p>}
      <p className="whitespace-pre-line text-sm leading-relaxed text-neuron-text/90">{item.summary}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-neuron-accent hover:underline"
        >
          Read source →
        </a>
        <TrustBadge classification="grounded" />
        <CiteButton kind="item" id={item.id} />
      </div>
      {item.steelmanContent && <SteelmanToggle itemId={item.id} interestId={interestId ?? null} content={item.steelmanContent} />}
    </article>
  );
}

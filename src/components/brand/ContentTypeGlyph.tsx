import type { SearchContentType } from "@/lib/searchTypes";

// One icon per content type (search results label each hit with its type).
// Same two-tone style as Glyph.tsx and TopicGlyph.tsx, kept simple enough to
// read at 16px: strokes in the current text colour plus a soft fill of it.

const S = { fill: "currentColor", fillOpacity: 0.22, stroke: "none" } as const;
const DOT = { fill: "currentColor", stroke: "none" } as const;

const TYPES: Record<SearchContentType, React.ReactNode> = {
  // A folded newspaper.
  news: (
    <>
      <rect x="3.5" y="5" width="14" height="14" rx="2" {...S} />
      <path d="M17.5 9h2a1 1 0 0 1 1 1v7a2 2 0 0 1-4 0V7a2 2 0 0 0-2-2h-9a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11" />
      <path d="M7 9h7M7 12.5h7M7 16h4" />
    </>
  ),
  // An open book.
  deep_dive: (
    <>
      <path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z" {...S} />
      <path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5zM12 6.5v13" />
    </>
  ),
  // A lit bulb.
  applied_insight: (
    <>
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.3.2.5.6.5 1V17h6v-2.1c0-.4.2-.8.5-1A6 6 0 0 0 12 3z" {...S} />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.3.2.5.6.5 1V17h6v-2.1c0-.4.2-.8.5-1A6 6 0 0 0 12 3zM9.5 20.5h5" />
    </>
  ),
  // A target: practice until you hit it.
  drill: (
    <>
      <circle cx="12" cy="12" r="8.5" {...S} />
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1.4" {...DOT} />
    </>
  ),
  // A pencil writing a line.
  explain_back: (
    <>
      <path d="M15.5 4.5l4 4L9 19l-5 1 1-5z" {...S} />
      <path d="M15.5 4.5l4 4L9 19l-5 1 1-5zM13 7l4 4M13 20.5h7" />
    </>
  ),
  // Three linked ideas.
  mental_model: (
    <>
      <path d="M7 16.5l5-9 5 9z" {...S} />
      <path d="M7 16.5l5-9 5 9z" />
      <circle cx="12" cy="6" r="2.5" />
      <circle cx="6" cy="17.5" r="2.5" />
      <circle cx="18" cy="17.5" r="2.5" />
    </>
  ),
  // A hole with an arrow going down into it.
  rabbit_hole: (
    <>
      <ellipse cx="12" cy="17" rx="8.5" ry="3.5" {...S} />
      <ellipse cx="12" cy="17" rx="8.5" ry="3.5" />
      <path d="M12 3.5v11M8.5 11l3.5 3.5 3.5-3.5" />
    </>
  ),
  // Books on a shelf.
  chapter: (
    <>
      <rect x="9.5" y="4.5" width="4.5" height="15" rx="1" {...S} />
      <path d="M4.5 4.5h4v15h-4zM9.5 4.5H14v15H9.5zM15.3 5.8l3.6-1 3.4 13.6-3.6 1zM3 19.5h18" />
    </>
  ),
  // A cube: one building block of an idea.
  concept: (
    <>
      <path d="M12 12l8-4.5v9L12 21z" {...S} />
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9" />
    </>
  ),
};

export function ContentTypeGlyph({ type, className = "h-4 w-4" }: { type: SearchContentType; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      {TYPES[type]}
    </svg>
  );
}

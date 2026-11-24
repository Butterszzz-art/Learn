// One drawn icon per built-in interest, in the same two-tone style as
// Glyph.tsx: rounded strokes in the current text colour plus a soft fill of
// the same colour. Set the colour on a parent (the interest picker uses each
// interest's own hue, --ic). Custom interests get the spark.

const S = { fill: "currentColor", fillOpacity: 0.2, stroke: "none" } as const; // soft second tone
const DOT = { fill: "currentColor", stroke: "none" } as const;

const TOPICS: Record<string, React.ReactNode> = {
  // A neuron: cell body, dendrites, and an axon ending in terminals.
  neuroscience: (
    <>
      <circle cx="8" cy="9" r="3.2" {...S} />
      <circle cx="8" cy="9" r="3.2" />
      <path d="M8 5.8V3M5.2 7.4L3 6M5.4 10.8L3.4 12.8M10.8 7.4L13 5.2" />
      <path d="M10.6 10.8c2.1 1.5 3.6 3.5 5 6.2M15.6 17l3.6 1.2M15.6 17l1 3.5M15.6 17l3.4-1.6" />
    </>
  ),
  // A thought bubble.
  psychology: (
    <>
      <path d="M7.5 15a3.5 3.5 0 0 1-.4-7A4.5 4.5 0 0 1 15.8 7a3.5 3.5 0 0 1 .7 8z" {...S} />
      <path d="M7.5 15a3.5 3.5 0 0 1-.4-7A4.5 4.5 0 0 1 15.8 7a3.5 3.5 0 0 1 .7 8z" />
      <circle cx="6" cy="18.5" r="1.3" />
      <circle cx="3.6" cy="21" r=".7" {...DOT} />
    </>
  ),
  // A classical temple front.
  philosophy: (
    <>
      <path d="M4 8.5L12 3.5l8 5z" {...S} />
      <path d="M4 8.5L12 3.5l8 5zM6.5 11.5v6M12 11.5v6M17.5 11.5v6M4 20.5h16" />
    </>
  ),
  // A scroll between two rods.
  history: (
    <>
      <rect x="6.5" y="5" width="11" height="14" {...S} />
      <path d="M6.5 5v14M17.5 5v14M4.5 5h15M4.5 19h15M9.5 9.5h5M9.5 12.5h5M9.5 15.5h3" />
    </>
  ),
  // A rising chart.
  economics: (
    <>
      <path d="M7.5 15l3.5-4 3 2.5 5-6V20H7.5z" {...S} />
      <path d="M4 4v16h16M7.5 15l3.5-4 3 2.5 5-6M15.5 7.5H19V11" />
    </>
  ),
  // A briefcase.
  business: (
    <>
      <rect x="3.5" y="7.5" width="17" height="12" rx="2.5" {...S} />
      <rect x="3.5" y="7.5" width="17" height="12" rx="2.5" />
      <path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 12.5h17M12 11.5v2" />
    </>
  ),
  // A ticked ballot going into a box.
  "political-science": (
    <>
      <rect x="4" y="11" width="16" height="9" rx="2" {...S} />
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8.5 11V4.5h7V11M10.3 7.8l1.3 1.3 2.3-2.5M8 14.5h8" />
    </>
  ),
  // A chip.
  "cs-ai": (
    <>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" {...S} />
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      <path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3" />
    </>
  ),
  // An atom.
  physics: (
    <>
      <circle cx="12" cy="12" r="4.5" {...S} />
      <ellipse cx="12" cy="12" rx="9" ry="3.6" />
      <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(-60 12 12)" />
      <circle cx="12" cy="12" r="1.8" {...DOT} />
    </>
  ),
  // A magnifier over a question.
  "critical-thinking": (
    <>
      <circle cx="10.5" cy="10.5" r="6" {...S} />
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5M8.8 8.9a1.8 1.8 0 1 1 2.4 1.7c-.4.2-.7.5-.7 1" />
      <circle cx="10.5" cy="13.4" r=".6" {...DOT} />
    </>
  ),
  // A heart with a pulse line.
  "exercise-science": (
    <>
      <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" {...S} />
      <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />
      <path d="M2.5 12.5h5l1.5-2.5 2.5 5 1.5-2.5h8.5" />
    </>
  ),
  // A lab flask.
  "philosophy-of-science": (
    <>
      <path d="M7.3 14.5h9.4l2.3 3.7a1.5 1.5 0 0 1-1.3 2.3H6.3A1.5 1.5 0 0 1 5 18.2z" {...S} />
      <path d="M9.5 3.5h5M10.5 3.5v5.2L5 18.2A1.5 1.5 0 0 0 6.3 20.5h11.4a1.5 1.5 0 0 0 1.3-2.3L13.5 8.7V3.5" />
      <circle cx="10.5" cy="17.3" r=".9" />
      <circle cx="13.8" cy="16.6" r=".6" {...DOT} />
    </>
  ),
  // The four operators.
  mathematics: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4.5" {...S} />
      <path d="M5.5 7.5h4M7.5 5.5v4M14.5 7.5h4M6 14.5l3 3M9 14.5l-3 3M14.5 16h4" />
      <circle cx="16.5" cy="13.8" r=".7" {...DOT} />
      <circle cx="16.5" cy="18.2" r=".7" {...DOT} />
    </>
  ),
  // A Venn diagram with the overlap filled.
  logic: (
    <>
      <path d="M12 7.39A5.5 5.5 0 0 1 12 16.61A5.5 5.5 0 0 1 12 7.39z" fill="currentColor" fillOpacity={0.35} stroke="none" />
      <circle cx="9" cy="12" r="5.5" />
      <circle cx="15" cy="12" r="5.5" />
    </>
  ),
  // A paw print.
  "animal-world": (
    <>
      <path d="M12 12.5c-3 0-5.5 3-5.5 5.2 0 1.6 1.3 2.3 2.8 2.3 1.1 0 1.7-.6 2.7-.6s1.6.6 2.7.6c1.5 0 2.8-.7 2.8-2.3 0-2.2-2.5-5.2-5.5-5.2z" {...S} />
      <path d="M12 12.5c-3 0-5.5 3-5.5 5.2 0 1.6 1.3 2.3 2.8 2.3 1.1 0 1.7-.6 2.7-.6s1.6.6 2.7.6c1.5 0 2.8-.7 2.8-2.3 0-2.2-2.5-5.2-5.5-5.2z" />
      <ellipse cx="5" cy="10.5" rx="1.6" ry="2.1" transform="rotate(-20 5 10.5)" />
      <ellipse cx="9.2" cy="6.3" rx="1.6" ry="2.1" />
      <ellipse cx="14.8" cy="6.3" rx="1.6" ry="2.1" />
      <ellipse cx="19" cy="10.5" rx="1.6" ry="2.1" transform="rotate(20 19 10.5)" />
    </>
  ),
  // A DNA double helix.
  biology: (
    <>
      <path d="M8 4.6h8M8 10.4h8M8 13.6h8M8 19.4h8" strokeOpacity={0.55} />
      <path d="M7 3c0 4.5 10 4.5 10 9s-10 4.5-10 9M17 3c0 4.5-10 4.5-10 9s10 4.5 10 9" />
    </>
  ),
  // A sprout.
  evolution: (
    <>
      <path d="M12 13C12 8.5 8.5 6 4.5 6c0 4.5 3 7 7.5 7zM12 11c0-4 3-6.5 7.5-6.5 0 4-3 6.5-7.5 6.5z" {...S} />
      <path d="M12 21v-10M12 13C12 8.5 8.5 6 4.5 6c0 4.5 3 7 7.5 7zM12 11c0-4 3-6.5 7.5-6.5 0 4-3 6.5-7.5 6.5zM7.5 21h9" />
    </>
  ),
};

// Custom interests: a four-point spark.
const FALLBACK = (
  <>
    <path d="M12 3.5l2 6.5 6.5 2-6.5 2-2 6.5-2-6.5-6.5-2 6.5-2z" {...S} />
    <path d="M12 3.5l2 6.5 6.5 2-6.5 2-2 6.5-2-6.5-6.5-2 6.5-2z" />
  </>
);

export function TopicGlyph({ slug, className = "h-6 w-6" }: { slug: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      {TOPICS[slug] ?? FALLBACK}
    </svg>
  );
}

// Duotone brand glyphs for marketing and empty-state surfaces, drawn to sit
// beside the logo mark: rounded 2px strokes in the violet accent, with a
// soft pink or teal fill for the second tone. They follow the theme tokens,
// so light and dark mode need nothing extra. (Small UI icons live in Icon.tsx.)

export type GlyphName =
  | "level"
  | "remember"
  | "sources"
  | "paper"
  | "quiz"
  | "explainer"
  | "sparkle"
  | "celebrate"
  | "sprout"
  | "leaf"
  | "done"
  | "offline"
  | "graduate"
  | "microscope"
  | "library";

const soft = (token: "accent2" | "accent3", alpha = 0.28) => ({ fill: `rgb(var(--n-${token}) / ${alpha})` });
const solid = (token: "accent2" | "accent3") => ({ stroke: `rgb(var(--n-${token}))` });
const dot = (token: "accent2" | "accent3") => ({ fill: `rgb(var(--n-${token}))`, stroke: "none" });

const DRAWINGS: Record<GlyphName, React.ReactNode> = {
  // Rising steps with a flag on the last: difficulty that climbs with you.
  level: (
    <>
      <rect x="3.5" y="14" width="5" height="6.5" rx="1.5" />
      <rect x="9.5" y="10" width="5" height="10.5" rx="1.5" />
      <rect x="15.5" y="6.5" width="5" height="14" rx="1.5" style={soft("accent2")} />
      <path d="M18 6.5V2.5l3 1.3-3 1.3" style={solid("accent2")} />
    </>
  ),
  // A review loop closing around a check: spaced repetition.
  remember: (
    <>
      <path d="M19.5 9.5A8 8 0 1 0 20 14" />
      <path d="M20.5 4.5v5h-5" />
      <circle cx="12" cy="12" r="4" stroke="none" style={soft("accent3", 0.3)} />
      <path d="M10 12l1.5 1.5 2.7-3" style={solid("accent3")} />
    </>
  ),
  // A page with a verified seal: every claim is sourced.
  sources: (
    <>
      <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21H11" />
      <path d="M14 3l5 5h-3.5A1.5 1.5 0 0 1 14 6.5z" style={soft("accent2")} />
      <path d="M8.5 11h6M8.5 14.5h3" />
      <circle cx="17" cy="17" r="4" style={{ ...soft("accent3", 0.3), ...solid("accent3") }} />
      <path d="M15.4 17l1.1 1.1 2-2.2" style={solid("accent3")} />
    </>
  ),
  // A research paper.
  paper: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" style={soft("accent2", 0.18)} />
      <path d="M8.5 8h7M8.5 11.5h7M8.5 15h4" />
    </>
  ),
  // A speech bubble with a question.
  quiz: (
    <>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z" style={soft("accent3", 0.22)} />
      <path d="M10 8.6a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.4" />
      <circle cx="12" cy="13.6" r=".6" fill="currentColor" stroke="none" />
    </>
  ),
  // A lit bulb: a long-form explainer.
  explainer: (
    <>
      <path d="M9 17h6M10 20.5h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.3.2.5.6.5 1V17h6v-2.1c0-.4.2-.8.5-1A6 6 0 0 0 12 3z" style={soft("accent2", 0.24)} />
    </>
  ),
  // Two four-point stars: a recap of what you learned.
  sparkle: (
    <>
      <path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z" style={soft("accent2")} />
      <path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z" style={{ ...soft("accent3", 0.3), ...solid("accent3") }} />
    </>
  ),
  // A party popper: you're all caught up.
  celebrate: (
    <>
      <path d="M4 20l4.5-11 6.5 6.5z" style={soft("accent2")} />
      <path d="M8.5 13.5l2 2M13.5 4.5l.8 2.2M18.5 6l-1.8 1.6M20 11.2l-2.3.4" />
      <circle cx="10.5" cy="4.5" r="1" style={dot("accent3")} />
      <circle cx="20" cy="15.5" r="1" style={dot("accent2")} />
      <circle cx="16.5" cy="2.8" r=".8" style={dot("accent2")} />
    </>
  ),
  // A sprout: today's set is done and the habit is growing.
  sprout: (
    <>
      <path d="M12 13C12 8.5 8.5 6 4.5 6c0 4.5 3 7 7.5 7zM12 11c0-4 3-6.5 7.5-6.5 0 4-3 6.5-7.5 6.5z" style={{ ...soft("accent3", 0.3), ...solid("accent3") }} />
      <path d="M12 21v-10M7.5 21h9" />
    </>
  ),
  // A leaf: nothing due, rest easy.
  leaf: (
    <>
      <path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14z" style={{ ...soft("accent3", 0.3), ...solid("accent3") }} />
      <path d="M5 19l9-9M10 14H7M14 10V7" style={solid("accent3")} />
    </>
  ),
  // A ticked circle: done.
  done: (
    <>
      <circle cx="12" cy="12" r="8.5" style={{ ...soft("accent3", 0.25), ...solid("accent3") }} />
      <path d="M8 12.5l2.7 2.7L16 9.5" style={solid("accent3")} />
    </>
  ),
  // Signal waves with a line through them: no connection.
  offline: (
    <>
      <path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0" />
      <circle cx="12" cy="19.3" r="1.2" fill="currentColor" stroke="none" />
      <path d="M4 3.5l16 17" style={solid("accent2")} />
    </>
  ),
  // A graduation cap: your course syllabus.
  graduate: (
    <>
      <path d="M2.5 9.5L12 5l9.5 4.5L12 14z" style={soft("accent2")} />
      <path d="M6.5 11.8V16c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5v-4.2M21.5 9.5v5" />
    </>
  ),
  // A microscope: the research agent.
  microscope: (
    <>
      <rect x="8.5" y="2.5" width="4" height="9.5" rx="1" transform="rotate(-25 10.5 7.25)" style={soft("accent2")} />
      <path d="M12.3 12.6v2.4M7.5 15h8M15 6a7.5 7.5 0 0 1 1.5 13M4.5 20.5h15" />
    </>
  ),
  // Books on a shelf: your uploaded library.
  library: (
    <>
      <rect x="9.5" y="4.5" width="4.5" height="15" rx="1" style={soft("accent2")} />
      <path d="M4.5 4.5h4v15h-4zM9.5 4.5H14v15H9.5zM15.3 5.8l3.6-1 3.4 13.6-3.6 1zM3 19.5h18" />
    </>
  ),
};

/** Violet by default; pass a text-* class (text-current to inherit) to recolour the strokes. */
export function Glyph({ name, className = "h-7 w-7" }: { name: GlyphName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={/(^|\s)text-/.test(className) ? className : `text-neuron-accent ${className}`}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {DRAWINGS[name]}
    </svg>
  );
}

const BADGE_TONE = {
  accent: "bg-neuron-accent/10 text-neuron-accent",
  accent2: "bg-neuron-accent2/10 text-neuron-accent2",
  accent3: "bg-neuron-accent3/10 text-neuron-accent3",
} as const;

/** A large glyph on a soft round tile, for empty states and celebrations. */
export function GlyphBadge({ name, tone = "accent", size = "md" }: { name: GlyphName; tone?: keyof typeof BADGE_TONE; size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-24 w-24" : "h-16 w-16";
  const icon = size === "lg" ? "h-14 w-14" : "h-9 w-9";
  return (
    <span aria-hidden className={`mx-auto flex items-center justify-center rounded-full ${box} ${BADGE_TONE[tone]}`}>
      <Glyph name={name} className={`${icon} text-current`} />
    </span>
  );
}

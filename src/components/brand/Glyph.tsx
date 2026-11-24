// Duotone brand glyphs for marketing and empty-state surfaces, drawn to sit
// beside the logo mark: rounded 2px strokes in the violet accent, with a
// soft pink or teal fill for the second tone. They follow the theme tokens,
// so light and dark mode need nothing extra. (Small UI icons live in Icon.tsx.)

export type GlyphName = "level" | "remember" | "sources" | "paper" | "quiz" | "explainer";

const soft = (token: "accent2" | "accent3", alpha = 0.28) => ({ fill: `rgb(var(--n-${token}) / ${alpha})` });
const solid = (token: "accent2" | "accent3") => ({ stroke: `rgb(var(--n-${token}))` });

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

import { Glyph, type GlyphName } from "./Glyph";

// The welcome page's hero: a small stack of sample cards that swipe away one
// after another, so a visitor sees what the feed is before reading about it.
// Pure CSS (see .hero-stack in globals.css); with reduced motion it is a
// still, fanned stack.

type Sample = { glyph: GlyphName; kind: string; field: string; title: string; body: string; footer: string; tone: "accent" | "accent2" | "accent3" };

const SAMPLES: Sample[] = [
  {
    glyph: "paper",
    kind: "Research",
    field: "Neuroscience",
    title: "Sleep is when your brain takes out the trash",
    body: "During sleep, the space between brain cells widens and fluid flushes waste out far faster than when you're awake.",
    footer: "Peer-reviewed · Science, 2013",
    tone: "accent",
  },
  {
    glyph: "quiz",
    kind: "Quick check",
    field: "Astronomy",
    title: "Which planet's day is longer than its year?",
    body: "Venus spins so slowly that one rotation takes 243 Earth days, longer than its 225-day orbit.",
    footer: "Tap to answer",
    tone: "accent3",
  },
  {
    glyph: "explainer",
    kind: "Explainer",
    field: "Biology",
    title: "Why an octopus has three hearts",
    body: "Two pump blood through the gills, one through the body, and that one pauses while the octopus swims.",
    footer: "3 sources",
    tone: "accent2",
  },
];

const TONE: Record<Sample["tone"], string> = {
  accent: "text-neuron-accent bg-neuron-accent/10",
  accent2: "text-neuron-accent2 bg-neuron-accent2/10",
  accent3: "text-neuron-accent3 bg-neuron-accent3/10",
};

export function CardStackHero() {
  return (
    <div className="relative mx-auto w-full max-w-[22rem]" aria-label="Sample cards from the feed" role="img">
      {/* Soft glow behind the stack. */}
      <div aria-hidden className="absolute inset-x-6 inset-y-8 rounded-full bg-gradient-to-br from-neuron-accent/35 to-neuron-accent2/30 blur-3xl" />
      <div aria-hidden className="hero-stack relative h-[17rem]">
        {SAMPLES.map((s) => (
          <article key={s.title} className="hero-card absolute inset-x-0 top-6 flex h-60 flex-col rounded-3xl border border-neuron-border bg-neuron-surface p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-extrabold ${TONE[s.tone]}`}>
                <Glyph name={s.glyph} className="h-4 w-4 text-current" />
                {s.kind}
              </span>
              <span className="text-xs font-bold text-neuron-muted">{s.field}</span>
            </div>
            <h3 className="mt-3 font-display text-lg font-bold leading-snug">{s.title}</h3>
            <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-neuron-muted">{s.body}</p>
            <p className="mt-auto pt-2 text-xs font-bold text-neuron-muted/80">{s.footer}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

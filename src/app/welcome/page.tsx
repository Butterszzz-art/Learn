import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "@/components/brand/LogoMark";
import { Glyph, type GlyphName } from "@/components/brand/Glyph";
import { CardStackHero } from "@/components/brand/CardStackHero";

export const dynamic = "force-dynamic";
export const metadata = { title: "Neuron — swipe through real science" };

// The hero already shows "one idea per swipe", so the list covers the rest.
const POINTS: { glyph: GlyphName; title: string; text: string }[] = [
  { glyph: "level", title: "Matched to your level", text: "From first principles to the research frontier, per field. It gets harder as you do." },
  { glyph: "remember", title: "Built so you remember", text: "Quick checks and well-timed reviews turn what you read into what you know." },
  { glyph: "sources", title: "Sources on everything", text: "Every claim links to where it came from, with peer-reviewed and preprint clearly marked." },
];

export default async function WelcomePage() {
  if (await getCurrentUser()) redirect("/");
  return (
    // Bottom padding on phones leaves room for the pinned buttons.
    <div className="flex min-h-[85dvh] flex-col pb-32 sm:pb-0">
      <header className="flex items-center justify-between">
        <Logo size={30} />
        <Link href="/login" className="text-sm font-bold text-neuron-muted hover:text-neuron-text">
          Sign in
        </Link>
      </header>

      <h1 className="mt-8 font-display text-4xl font-bold leading-tight sm:mt-12 sm:text-5xl">
        Scroll less. <span className="bg-gradient-to-r from-neuron-accent to-neuron-accent2 bg-clip-text text-transparent">Know more.</span>
      </h1>
      <p className="mt-3 max-w-xl text-lg leading-relaxed text-neuron-muted">
        A swipe feed for science and ideas. Same thumb motion as any other feed, except every card leaves you knowing something real.
      </p>

      {/* Full-bleed on phones so a card swiping off leaves at the screen edge. */}
      <section className="-mx-5 mt-6 overflow-x-clip px-5 sm:mt-8">
        <CardStackHero />
      </section>

      <div className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-neuron-bg via-neuron-bg/95 to-transparent px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-8 sm:static sm:mt-8 sm:bg-none sm:p-0">
        <div className="mx-auto flex max-w-2xl flex-col gap-2 sm:flex-row sm:gap-3">
          <Link href="/signup" className="btn-primary w-full sm:w-auto">
            Get started, it's free
          </Link>
          <Link href="/login" className="btn-ghost w-full sm:hidden">
            I already have an account
          </Link>
        </div>
      </div>

      <ul className="mt-10 space-y-5">
        {POINTS.map((p) => (
          <li key={p.title} className="flex gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-neuron-border bg-neuron-surface">
              <Glyph name={p.glyph} />
            </span>
            <div>
              <h2 className="font-display text-lg font-bold">{p.title}</h2>
              <p className="mt-0.5 text-sm leading-relaxed text-neuron-muted">{p.text}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-10 text-xs text-neuron-muted">
        <Link href="/privacy" className="underline">
          Privacy
        </Link>{" "}
        ·{" "}
        <Link href="/terms" className="underline">
          Terms
        </Link>
      </p>
    </div>
  );
}

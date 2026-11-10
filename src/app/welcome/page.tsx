import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Neuron — swipe through real science" };

const POINTS = [
  { icon: "⚡", title: "One idea per swipe", text: "Short cards drawn from real research and long-form explainers — each one teaches a single thing." },
  { icon: "🎯", title: "Matched to your level", text: "From first principles to research frontier, per field. It keeps getting harder as you do." },
  { icon: "🧠", title: "Built so you remember", text: "Quick checks and well-timed reviews turn what you read into what you know." },
  { icon: "🔎", title: "Sources on everything", text: "Every claim links back to where it came from, with peer-reviewed and preprint clearly marked." },
];

export default async function WelcomePage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <div className="flex min-h-[85dvh] flex-col justify-center">
      <p className="text-5xl" aria-hidden>🧠</p>
      <h1 className="mt-4 font-display text-4xl font-bold leading-tight sm:text-5xl">
        Scroll less.{" "}
        <span className="bg-gradient-to-r from-neuron-accent to-neuron-accent2 bg-clip-text text-transparent">Know more.</span>
      </h1>
      <p className="mt-4 max-w-xl text-lg leading-relaxed text-neuron-muted">
        Neuron is a swipe feed for science and ideas. Same thumb motion as any other feed — except every card leaves you knowing something real.
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <Link href="/signup" className="btn-primary">Get started — it's free</Link>
        <Link href="/login" className="btn-secondary">Sign in</Link>
      </div>
      <ul className="mt-10 grid gap-3 sm:grid-cols-2">
        {POINTS.map((p) => (
          <li key={p.title} className="card">
            <p className="text-2xl" aria-hidden>{p.icon}</p>
            <h2 className="mt-2 font-display text-lg font-bold">{p.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-neuron-muted">{p.text}</p>
          </li>
        ))}
      </ul>
      <p className="mt-8 text-xs text-neuron-muted">
        <Link href="/privacy" className="underline">Privacy</Link> · <Link href="/terms" className="underline">Terms</Link>
      </p>
    </div>
  );
}

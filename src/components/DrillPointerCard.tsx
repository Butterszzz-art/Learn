import Link from "next/link";

/** A short, lightweight pointer — NOT the drills themselves. Drills are a
 * denser, more interactive format that belongs in its own tab, not embedded
 * in the reading stream (same reasoning as Library chapters — see
 * BookChapterPointerCard.tsx). */
export function DrillPointerCard({ count }: { count: number }) {
  return (
    <Link
      href="/drills"
      className="card block border-neuron-accent3/40 bg-gradient-to-br from-neuron-surface to-neuron-surface2 transition hover:border-neuron-accent3"
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">🧩</span>
        <p className="text-sm">
          <span className="font-semibold text-neuron-accent3">
            {count} drill{count === 1 ? "" : "s"} ready
          </span>{" "}
          — practice in Drills →
        </p>
      </div>
    </Link>
  );
}

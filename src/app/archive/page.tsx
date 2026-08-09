import Link from "next/link";
import { listCycles } from "@/lib/digest";

export const dynamic = "force-dynamic";

export default async function ArchivePage() {
  const cycles = await listCycles();

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-bold">Archive</h1>
      {cycles.length === 0 ? (
        <p className="text-sm text-neuron-muted">No cycles compiled yet.</p>
      ) : (
        <ul className="space-y-3">
          {cycles.map((c) => (
            <li key={c.id}>
              <Link
                href={`/archive/${c.id}`}
                className="card flex items-center justify-between transition hover:-translate-y-0.5 hover:border-neuron-accent hover:shadow-xl hover:shadow-neuron-accent/10"
              >
                <div>
                  <p className="font-medium">{c.periodLabel}</p>
                  <p className="text-xs text-neuron-muted">
                    {c.frequency} · {c.newsCount} news · {c.deepDiveCount} deep dives ·{" "}
                    {c.insightCount} insights{c.drillCount > 0 ? ` · ${c.drillCount} drills` : ""} ·{" "}
                    {new Date(c.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span className="text-neuron-muted">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import Link from "next/link";
import { listCycles } from "@/lib/digest";

export const dynamic = "force-dynamic";

export default async function ArchivePage() {
  const cycles = await listCycles();

  return (
    <div>
      <h1 className="mb-6 font-serif text-2xl">Archive</h1>
      {cycles.length === 0 ? (
        <p className="text-sm text-brain-muted">No cycles compiled yet.</p>
      ) : (
        <ul className="space-y-3">
          {cycles.map((c) => (
            <li key={c.id}>
              <Link
                href={`/archive/${c.id}`}
                className="card flex items-center justify-between hover:border-brain-accent"
              >
                <div>
                  <p className="font-medium">{c.periodLabel}</p>
                  <p className="text-xs text-brain-muted">
                    {c.frequency} · {c.newsCount} news · {c.deepDiveCount} deep dives ·{" "}
                    {c.insightCount} insights · {new Date(c.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span className="text-brain-muted">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

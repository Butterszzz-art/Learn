import Link from "next/link";
import { listDigests } from "@/lib/digest";

export const dynamic = "force-dynamic";

export default async function ArchivePage() {
  const digests = await listDigests();

  return (
    <div>
      <h1 className="mb-6 font-serif text-2xl">Archive</h1>
      {digests.length === 0 ? (
        <p className="text-sm text-brain-muted">No digests compiled yet.</p>
      ) : (
        <ul className="space-y-3">
          {digests.map((d) => (
            <li key={d.id}>
              <Link href={`/archive/${d.id}`} className="card flex items-center justify-between hover:border-brain-accent">
                <div>
                  <p className="font-medium">{d.periodLabel}</p>
                  <p className="text-xs text-brain-muted">
                    {d.frequency} · {d.itemCount} items · {new Date(d.createdAt).toLocaleDateString()}
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

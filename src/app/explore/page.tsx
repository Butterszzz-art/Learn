import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getCatalog } from "@/lib/interests";
import { getLearningPaths, getTrendingConcepts } from "@/lib/explore";
import { LEVEL_LABELS } from "@/db/schema";
import { interestStyle } from "@/lib/ui";
import { SearchBox } from "@/components/SearchBox";

export const dynamic = "force-dynamic";
export const metadata = { title: "Explore" };

const MIN_LEARNERS_TO_SHOW_COUNT = 5;

export default async function ExplorePage() {
  const user = await requireUser();
  const catalog = await getCatalog(user.id);
  const followed = catalog.filter((i) => i.enabled);
  const others = catalog.filter((i) => !i.enabled);
  const [paths, trending] = await Promise.all([getLearningPaths(user.id, followed), getTrendingConcepts()]);

  return (
    <div>
      <h1 className="page-title">Explore</h1>
      <div className="mt-4"><SearchBox /></div>

      <section className="mt-8" aria-labelledby="paths-heading">
        <h2 id="paths-heading" className="font-display text-xl font-bold">Your learning paths</h2>
        <p className="mb-4 mt-1 text-sm text-neuron-muted">Each field is a sequence that builds on itself. Jump to any entry, or let the feed bring them to you in order.</p>
        <ul className="space-y-3">
          {paths.map((p) => (
            <li key={p.interestId} className="card" style={interestStyle(p.interestId)}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-display text-lg font-bold">{p.interestName}</h3>
                <span className="text-xs font-bold text-neuron-muted">{LEVEL_LABELS[p.level]} · {p.done}/{p.entries.length} started</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-neuron-surface2" role="progressbar" aria-valuemin={0} aria-valuemax={Math.max(1, p.entries.length)} aria-valuenow={p.done} aria-label={`${p.interestName} progress`}>
                <div className="h-full rounded-full bg-[var(--ic)]" style={{ width: `${p.entries.length ? (p.done / p.entries.length) * 100 : 0}%` }} />
              </div>
              {p.entries.length === 0 ? (
                <p className="mt-3 text-sm text-neuron-muted">The first entries are being written — they'll appear in your feed shortly.</p>
              ) : (
                <ol className="mt-3 space-y-1">
                  {p.entries.slice(0, 8).map((e, i) => (
                    <li key={e.deepDiveId}>
                      <Link href={`/deep-dive/${e.deepDiveId}`} className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-sm font-semibold hover:bg-neuron-surface2">
                        <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${e.seen ? "bg-[var(--ic)] text-white" : "border border-neuron-border text-neuron-muted"}`}>{e.seen ? "✓" : i + 1}</span>
                        <span className={e.seen ? "text-neuron-muted" : ""}>{e.topic}</span>
                        {e.seen && <span className="sr-only">(started)</span>}
                      </Link>
                    </li>
                  ))}
                  {p.entries.length > 8 && <li className="px-2 pt-1 text-xs text-neuron-muted">+ {p.entries.length - 8} more</li>}
                </ol>
              )}
            </li>
          ))}
        </ul>
      </section>

      {trending.length > 0 && (
        <section className="mt-10" aria-labelledby="trending-heading">
          <h2 id="trending-heading" className="font-display text-xl font-bold">What people are learning this week</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {trending.map((t) => (
              <li key={t.conceptId}>
                <Link href={t.deepDiveId ? `/deep-dive/${t.deepDiveId}` : "/explore"} className="pill !py-2 !text-neuron-text hover:border-neuron-accent">
                  {t.name}
                  <span className="font-normal text-neuron-muted">· {t.interestName}{t.learners >= MIN_LEARNERS_TO_SHOW_COUNT ? ` · ${t.learners} learners` : ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {others.length > 0 && (
        <section className="mt-10" aria-labelledby="more-heading">
          <h2 id="more-heading" className="font-display text-xl font-bold">More fields</h2>
          <p className="mb-3 mt-1 text-sm text-neuron-muted">A few cards from these already turn up in your feed. Follow one to get its full path.</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {others.map((i) => (
              <li key={i.id} className="card !p-4">
                <p className="font-bold">{i.name}</p>
                {i.description && <p className="mt-1 text-sm text-neuron-muted">{i.description}</p>}
              </li>
            ))}
          </ul>
          <Link href="/settings#interests" className="btn-secondary mt-4">Change my interests</Link>
        </section>
      )}
    </div>
  );
}

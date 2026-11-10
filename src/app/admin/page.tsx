import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getAdminStats, getFlaggedDives, getOpenReports, getRecentErrors } from "@/lib/admin";
import { formatDate } from "@/lib/ui";
import { AdminButton, SetPlanForm } from "@/components/AdminActions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin" };

const usd = (n: number) => (n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card !p-4">
      <p className="text-xs font-bold text-neuron-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-neuron-muted">{hint}</p>}
    </div>
  );
}

export default async function AdminPage() {
  await requireAdmin();
  const [stats, flagged, reports, errors] = await Promise.all([getAdminStats(), getFlaggedDives(), getOpenReports(), getRecentErrors()]);
  const target = 0.03;
  return (
    <div>
      <h1 className="page-title">Admin</h1>

      <section className="mt-6" aria-labelledby="people-heading">
        <h2 id="people-heading" className="eyebrow mb-3">People and content</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Accounts" value={stats.users} hint={`${stats.proUsers} on Pro`} />
          <Stat label="Active, last 7 days" value={stats.active7d} />
          <Stat label="Cards seen, 7 days" value={stats.cardsSeen7d} />
          <Stat label="Quiz accuracy, 7 days" value={stats.quizAccuracy7d === null ? "–" : `${Math.round(stats.quizAccuracy7d * 100)}%`} />
          <Stat label="Cards in the pool" value={stats.cards} />
          <Stat label="Deep dives published" value={stats.deepDives} hint={`${stats.flaggedDives} held back`} />
          <Stat label="Concepts mapped" value={stats.concepts} />
          <Stat label="Jobs waiting" value={stats.jobsPending} hint={`${stats.jobsFailed7d} failed in 7 days`} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <AdminButton action={{ type: "run_tick" }} label="Run a generation tick now" />
          <AdminButton action={{ type: "retry_failed_jobs" }} label="Retry failed jobs" />
        </div>
      </section>

      <section className="mt-8" aria-labelledby="cost-heading">
        <h2 id="cost-heading" className="eyebrow mb-3">AI spend (estimated from token usage)</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Last 24 hours" value={usd(stats.spendToday)} />
          <Stat label="Last 7 days" value={usd(stats.spend7d)} />
          <Stat label="Last 30 days" value={usd(stats.spend30d)} />
          <Stat
            label="Per active user per day"
            value={stats.costPerActiveUserDay === null ? "–" : usd(stats.costPerActiveUserDay)}
            hint={stats.costPerActiveUserDay === null ? "No activity yet" : stats.costPerActiveUserDay <= target ? `Under the ${usd(target)} target` : `Over the ${usd(target)} target`}
          />
        </div>
        {stats.spendByPurpose.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Spend by purpose, last 7 days</caption>
              <thead>
                <tr className="text-left text-xs text-neuron-muted">
                  <th scope="col" className="p-2">Purpose</th><th scope="col" className="p-2">Model</th><th scope="col" className="p-2 text-right">Calls</th><th scope="col" className="p-2 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {stats.spendByPurpose.map((r) => (
                  <tr key={r.purpose + r.model} className="border-t border-neuron-border">
                    <td className="p-2 font-semibold">{r.purpose}</td><td className="p-2 text-neuron-muted">{r.model}</td>
                    <td className="p-2 text-right tabular-nums">{r.calls}</td><td className="p-2 text-right tabular-nums">{usd(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-8" aria-labelledby="reports-heading">
        <h2 id="reports-heading" className="eyebrow mb-3">Open reports ({reports.length})</h2>
        {reports.length === 0 ? <p className="text-sm text-neuron-muted">None.</p> : (
          <ul className="space-y-2">
            {reports.map((r) => (
              <li key={r.id} className="card !p-4">
                <p className="font-bold">{r.title ?? "(deleted)"}{r.cardStatus === "flagged" ? " — hidden" : ""}</p>
                <p className="mt-1 text-sm">{r.reason}</p>
                <p className="mt-1 text-xs text-neuron-muted">{formatDate(r.createdAt)}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.cardId && <Link href={`/card/${r.cardId}`} className="btn-ghost !min-h-[36px] !py-1 !text-xs">View card</Link>}
                  {r.deepDiveId && <Link href={`/deep-dive/${r.deepDiveId}`} className="btn-ghost !min-h-[36px] !py-1 !text-xs">View entry</Link>}
                  {r.cardId && (r.cardStatus === "flagged"
                    ? <AdminButton action={{ type: "restore_card", id: r.cardId }} label="Restore card" />
                    : <AdminButton action={{ type: "hide_card", id: r.cardId }} label="Hide card" tone="danger" />)}
                  {r.deepDiveId && <AdminButton action={{ type: "flag_dive", id: r.deepDiveId }} label="Unpublish entry" tone="danger" />}
                  <AdminButton action={{ type: "resolve_report", id: r.id }} label="Dismiss" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8" aria-labelledby="flagged-heading">
        <h2 id="flagged-heading" className="eyebrow mb-3">Held back by the source check ({flagged.length})</h2>
        {flagged.length === 0 ? <p className="text-sm text-neuron-muted">None.</p> : (
          <ul className="space-y-2">
            {flagged.map((d) => (
              <li key={d.id} className="card !p-4">
                <p className="font-bold">{d.topic}</p>
                <p className="text-xs text-neuron-muted">{d.interestName} · {d.level} · score {d.qualityScore ?? "–"} · {formatDate(d.createdAt)}</p>
                {d.qualityNotes && <p className="mt-2 text-sm">{d.qualityNotes}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={`/deep-dive/${d.id}`} className="btn-ghost !min-h-[36px] !py-1 !text-xs">Read it</Link>
                  <AdminButton action={{ type: "publish_dive", id: d.id }} label="Publish anyway" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8" aria-labelledby="plan-heading">
        <h2 id="plan-heading" className="eyebrow mb-3">Set an account's plan</h2>
        <div className="card"><SetPlanForm /></div>
      </section>

      <section className="mt-8" aria-labelledby="errors-heading">
        <h2 id="errors-heading" className="eyebrow mb-3">Recent errors</h2>
        {errors.length === 0 ? <p className="text-sm text-neuron-muted">None logged.</p> : (
          <ul className="space-y-1.5 text-sm">
            {errors.map((e) => (
              <li key={e.id} className="rounded-2xl bg-neuron-surface p-3">
                <details>
                  <summary className="cursor-pointer font-semibold"><span className="pill mr-2">{e.source}</span>{e.message} <span className="text-xs font-normal text-neuron-muted">{formatDate(e.createdAt)}</span></summary>
                  {e.detail && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-neuron-muted">{e.detail}</pre>}
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

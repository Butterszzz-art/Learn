import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PLAN_LIMITS } from "@/lib/plan";

export const dynamic = "force-dynamic";
export const metadata = { title: "Neuron Pro" };

const ROWS: { label: string; free: string; pro: string }[] = [
  { label: "The feed, quick checks and reviews", free: "Unlimited", pro: "Unlimited" },
  { label: "Knowledge map and score", free: "Included", pro: "Included" },
  { label: "Deep dives on a topic you pick", free: `${PLAN_LIMITS.free.onDemandDivesPerDay} a day`, pro: `${PLAN_LIMITS.pro.onDemandDivesPerDay} a day` },
  { label: "Ask about a card", free: `${PLAN_LIMITS.free.asksPerDay} questions a day`, pro: `${PLAN_LIMITS.pro.asksPerDay} a day` },
  { label: "Explain-it-back feedback", free: `${PLAN_LIMITS.free.explainBacksPerDay} a day`, pro: `${PLAN_LIMITS.pro.explainBacksPerDay} a day` },
  { label: "Your own custom fields", free: String(PLAN_LIMITS.free.customInterests), pro: String(PLAN_LIMITS.pro.customInterests) },
  { label: "Library books and articles", free: String(PLAN_LIMITS.free.libraryBooks), pro: String(PLAN_LIMITS.pro.libraryBooks) },
  { label: "Research-level paths", free: "—", pro: "Included" },
  { label: "Export everything at once", free: "—", pro: "Included" },
];

export default async function UpgradePage() {
  const user = await requireUser();
  const billingReady = !!process.env.NEXT_PUBLIC_BILLING_URL;
  return (
    <div>
      <Link href="/me" className="text-sm font-bold text-neuron-accent">← Me</Link>
      <h1 className="page-title mt-4">Neuron Pro</h1>
      <p className="mt-1 text-neuron-muted">The feed is free and stays free. Pro is for going further: more on-demand depth, your own fields, and a bigger Library.</p>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[420px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th scope="col" className="p-3 text-left font-bold text-neuron-muted">What you get</th>
              <th scope="col" className="p-3 text-left font-bold">Free</th>
              <th scope="col" className="rounded-t-2xl bg-neuron-accent/15 p-3 text-left font-bold">Pro</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.label}>
                <th scope="row" className="border-t border-neuron-border p-3 text-left font-semibold">{r.label}</th>
                <td className="border-t border-neuron-border p-3 text-neuron-muted">{r.free}</td>
                <td className="border-t border-neuron-border bg-neuron-accent/15 p-3 font-bold">{r.pro}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card mt-6">
        {user.plan === "pro" ? (
          <p className="font-bold">You're on Pro. Thank you for supporting Neuron.</p>
        ) : billingReady ? (
          <a href={process.env.NEXT_PUBLIC_BILLING_URL} className="btn-primary">Upgrade to Pro</a>
        ) : (
          <>
            <p className="font-bold">Pro isn't on sale yet.</p>
            <p className="mt-1 text-sm text-neuron-muted">Everything on the Free column works today. Paid plans open soon.</p>
          </>
        )}
      </div>
    </div>
  );
}

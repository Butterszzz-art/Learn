"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/ui";

export function AdminButton({ action, label, tone = "secondary" }: { action: Record<string, unknown>; label: string; tone?: "secondary" | "danger" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        className={`btn-secondary !min-h-[36px] !px-3 !py-1 !text-xs ${tone === "danger" ? "!border-neuron-danger/60 !text-neuron-danger" : ""}`}
        onClick={async () => {
          setBusy(true);
          const res = await postJson<{ message: string }>("/api/admin/action", action);
          setNote(res.ok ? res.data?.message ?? "Done." : res.error);
          setBusy(false);
          router.refresh();
        }}
      >
        {busy ? "…" : label}
      </button>
      {note && <span className="text-xs text-neuron-muted" role="status">{note}</span>}
    </span>
  );
}

export function SetPlanForm() {
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState("pro");
  const [note, setNote] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await postJson<{ message: string }>("/api/admin/action", { type: "set_plan", email, plan });
        setNote(res.ok ? res.data?.message ?? "Done." : res.error);
      }}
    >
      <div className="min-w-[200px] flex-1">
        <label htmlFor="plan-email" className="label">Account email</label>
        <input id="plan-email" type="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div>
        <label htmlFor="plan-value" className="label">Plan</label>
        <select id="plan-value" className="field" value={plan} onChange={(e) => setPlan(e.target.value)}>
          <option value="pro">Pro</option>
          <option value="free">Free</option>
        </select>
      </div>
      <button type="submit" className="btn-secondary">Set plan</button>
      {note && <p className="w-full text-sm text-neuron-muted" role="status">{note}</p>}
    </form>
  );
}

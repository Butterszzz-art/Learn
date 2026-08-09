"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function FrequencyForm({ initial }: { initial: "daily" | "weekly" }) {
  const router = useRouter();
  const [frequency, setFrequency] = useState<"daily" | "weekly">(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(next: "daily" | "weekly") {
    setFrequency(next);
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frequency: next }),
      });
      setSaved(true);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neuron-muted">
        Neuron cycle
      </h2>
      <div className="flex gap-3">
        {(["daily", "weekly"] as const).map((f) => (
          <button
            key={f}
            onClick={() => save(f)}
            disabled={saving}
            className={frequency === f ? "btn-primary" : "btn-secondary"}
          >
            {f === "daily" ? "Daily" : "Weekly"}
          </button>
        ))}
        {saved && <span className="self-center text-xs text-neuron-muted">Saved.</span>}
      </div>
      <p className="mt-2 text-xs text-neuron-muted">
        One deep dive is generated per enabled interest, once per cycle. Refreshing multiple times
        within the same cycle adds new curated items but won't duplicate deep dives.
      </p>
    </div>
  );
}

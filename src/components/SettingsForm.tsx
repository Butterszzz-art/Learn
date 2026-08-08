"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES } from "@/db/schema";
import type { Category } from "@/db/schema";
import type { AppSettings } from "@/lib/digest";

export function SettingsForm({ initial }: { initial: AppSettings }) {
  const router = useRouter();
  const [frequency, setFrequency] = useState<"daily" | "weekly">(initial.frequency);
  const [muted, setMuted] = useState<Set<Category>>(new Set(initial.mutedCategories));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggleCategory(category: Category) {
    setMuted((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frequency, mutedCategories: Array.from(muted) }),
      });
      setSaved(true);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="card">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brain-muted">
          Digest frequency
        </h2>
        <div className="flex gap-3">
          {(["daily", "weekly"] as const).map((f) => (
            <button
              key={f}
              onClick={() => {
                setFrequency(f);
                setSaved(false);
              }}
              className={frequency === f ? "btn-primary" : "btn-secondary"}
            >
              {f === "daily" ? "Daily" : "Weekly"}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-brain-muted">
          Determines the label given to each compiled digest. Refreshing always fetches new items —
          this setting doesn't limit when you can click "Refresh now".
        </p>
      </section>

      <section className="card">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brain-muted">
          Muted categories
        </h2>
        <div className="space-y-2">
          {CATEGORIES.map((category) => (
            <label key={category} className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={muted.has(category)}
                onChange={() => toggleCategory(category)}
                className="h-4 w-4 rounded border-brain-border bg-brain-surface2 accent-brain-accent"
              />
              {category}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-brain-muted">
          Muted categories are excluded from future digests. Past digests are unaffected.
        </p>
      </section>

      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
        {saved && <span className="text-xs text-brain-muted">Saved.</span>}
      </div>
    </div>
  );
}

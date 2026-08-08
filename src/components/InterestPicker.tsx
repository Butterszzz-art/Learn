"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LEVELS, LEVEL_LABELS } from "@/db/schema";
import type { Level } from "@/db/schema";

export interface InterestConfig {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  hasCuratedSource: boolean;
  level: Level;
  enabled: boolean;
}

export function InterestPicker({
  initial,
  mode,
  onSaved,
}: {
  initial: InterestConfig[];
  mode: "onboarding" | "settings";
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [config, setConfig] = useState<Map<number, { level: Level; enabled: boolean }>>(
    new Map(initial.map((i) => [i.id, { level: i.level, enabled: i.enabled }]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: number) {
    setConfig((prev) => {
      const next = new Map(prev);
      const current = next.get(id) ?? { level: "some_background" as Level, enabled: false };
      next.set(id, { ...current, enabled: !current.enabled });
      return next;
    });
  }

  function setLevel(id: number, level: Level) {
    setConfig((prev) => {
      const next = new Map(prev);
      const current = next.get(id) ?? { level: "some_background" as Level, enabled: true };
      next.set(id, { ...current, level });
      return next;
    });
  }

  const enabledCount = Array.from(config.values()).filter((c) => c.enabled).length;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        interests: initial.map((i) => {
          const c = config.get(i.id)!;
          return { interestId: i.id, level: c.level, enabled: c.enabled };
        }),
      };
      const res = await fetch("/api/interests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Save failed");

      if (mode === "onboarding") {
        router.push("/");
        router.refresh();
      } else {
        onSaved?.();
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {initial.map((interest) => {
          const c = config.get(interest.id) ?? { level: "some_background" as Level, enabled: false };
          return (
            <div
              key={interest.id}
              className={`card transition ${c.enabled ? "border-brain-accent/50" : "opacity-70"}`}
            >
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={() => toggle(interest.id)}
                  className="mt-1 h-4 w-4 rounded border-brain-border bg-brain-surface2 accent-brain-accent"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{interest.name}</span>
                    {!interest.hasCuratedSource && (
                      <span className="pill">deep-dive only</span>
                    )}
                  </div>
                  {interest.description && (
                    <p className="mt-0.5 text-xs text-brain-muted">{interest.description}</p>
                  )}
                </div>
              </label>

              {c.enabled && (
                <div className="mt-3 flex flex-wrap gap-2 pl-7">
                  {LEVELS.map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setLevel(interest.id, level)}
                      className={
                        c.level === level
                          ? "rounded-full bg-brain-accent px-3 py-1 text-xs font-medium text-brain-bg"
                          : "rounded-full border border-brain-border px-3 py-1 text-xs text-brain-muted hover:text-brain-text"
                      }
                    >
                      {LEVEL_LABELS[level]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={save} disabled={saving || enabledCount === 0}>
          {saving ? "Saving…" : mode === "onboarding" ? "Start my feed →" : "Save interests"}
        </button>
        {enabledCount === 0 && (
          <span className="text-xs text-brain-muted">Enable at least one interest to continue.</span>
        )}
      </div>
    </div>
  );
}

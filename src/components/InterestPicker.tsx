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
  isCustom: boolean;
  generatesAppliedInsights: boolean;
  isFavorite: boolean;
  level: Level;
  enabled: boolean;
}

interface RowConfig {
  level: Level;
  enabled: boolean;
  generatesAppliedInsights: boolean;
  isFavorite: boolean;
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
  const [interestList, setInterestList] = useState<InterestConfig[]>(initial);
  const [config, setConfig] = useState<Map<number, RowConfig>>(
    new Map(
      initial.map((i) => [
        i.id,
        {
          level: i.level,
          enabled: i.enabled,
          generatesAppliedInsights: i.generatesAppliedInsights,
          isFavorite: i.isFavorite,
        },
      ])
    )
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);

  const ROW_DEFAULT: RowConfig = {
    level: "some_background",
    enabled: false,
    generatesAppliedInsights: true,
    isFavorite: false,
  };

  function toggle(id: number) {
    setConfig((prev) => {
      const next = new Map(prev);
      const current = next.get(id) ?? ROW_DEFAULT;
      next.set(id, { ...current, enabled: !current.enabled });
      return next;
    });
  }

  function setLevel(id: number, level: Level) {
    setConfig((prev) => {
      const next = new Map(prev);
      const current = next.get(id) ?? ROW_DEFAULT;
      next.set(id, { ...current, level });
      return next;
    });
  }

  function toggleAppliedInsights(id: number) {
    setConfig((prev) => {
      const next = new Map(prev);
      const current = next.get(id) ?? ROW_DEFAULT;
      next.set(id, { ...current, generatesAppliedInsights: !current.generatesAppliedInsights });
      return next;
    });
  }

  function toggleFavorite(id: number) {
    setConfig((prev) => {
      const next = new Map(prev);
      const current = next.get(id) ?? ROW_DEFAULT;
      next.set(id, { ...current, isFavorite: !current.isFavorite });
      return next;
    });
  }

  async function addCustomInterest() {
    const name = customName.trim();
    if (!name) return;
    setAddingCustom(true);
    setError(null);
    try {
      const res = await fetch("/api/interests/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to add interest");

      const newInterest: InterestConfig = { ...data, level: "some_background", enabled: true };
      setInterestList((prev) => [...prev, newInterest]);
      setConfig((prev) => {
        const next = new Map(prev);
        next.set(newInterest.id, {
          level: "some_background",
          enabled: true,
          generatesAppliedInsights: newInterest.generatesAppliedInsights,
          isFavorite: false,
        });
        return next;
      });
      setCustomName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setAddingCustom(false);
    }
  }

  const enabledCount = Array.from(config.values()).filter((c) => c.enabled).length;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        interests: interestList.map((i) => {
          const c = config.get(i.id)!;
          return {
            interestId: i.id,
            level: c.level,
            enabled: c.enabled,
            generatesAppliedInsights: c.generatesAppliedInsights,
            isFavorite: c.isFavorite,
          };
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
        {interestList.map((interest) => {
          const c = config.get(interest.id) ?? {
            level: "some_background" as Level,
            enabled: false,
            generatesAppliedInsights: interest.generatesAppliedInsights,
            isFavorite: interest.isFavorite,
          };
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
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{interest.name}</span>
                    {interest.isCustom && <span className="pill">custom</span>}
                    {!interest.hasCuratedSource && <span className="pill">news via web search</span>}
                  </div>
                  {interest.description && (
                    <p className="mt-0.5 text-xs text-brain-muted">{interest.description}</p>
                  )}
                </div>
              </label>

              {c.enabled && (
                <div className="mt-3 space-y-3 pl-7">
                  <div className="flex flex-wrap gap-2">
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

                  {mode === "settings" && (
                    <>
                      <label className="flex items-center gap-2 text-xs text-brain-muted">
                        <input
                          type="checkbox"
                          checked={c.generatesAppliedInsights}
                          onChange={() => toggleAppliedInsights(interest.id)}
                          className="h-3.5 w-3.5 rounded border-brain-border bg-brain-surface2 accent-brain-accent"
                        />
                        Generate an Applied Insight card after each deep dive
                      </label>
                      <label className="flex items-center gap-2 text-xs text-brain-muted">
                        <input
                          type="checkbox"
                          checked={c.isFavorite}
                          onChange={() => toggleFavorite(interest.id)}
                          className="h-3.5 w-3.5 rounded border-brain-border bg-brain-surface2 accent-amber-400"
                        />
                        ⭐ Passion Mode — more deep dives per cycle, framed a notch deeper, plus Binge
                        and topic-picking in the feed
                      </label>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="card">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brain-muted">
          Don't see your field? Add any topic.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomInterest();
              }
            }}
            placeholder="e.g. Byzantine history, climate policy, jazz theory…"
            className="flex-1 rounded-lg border border-brain-border bg-brain-surface2 px-3 py-2 text-sm text-brain-text placeholder:text-brain-muted focus:border-brain-accent focus:outline-none"
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={addCustomInterest}
            disabled={addingCustom || !customName.trim()}
          >
            {addingCustom ? "Adding…" : "Add"}
          </button>
        </div>
        <p className="mt-2 text-xs text-brain-muted">
          Custom interests get a web-search-generated News roundup instead of a fixed RSS feed, plus
          the same Deep Dive and Applied Insight treatment as everything else.
        </p>
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

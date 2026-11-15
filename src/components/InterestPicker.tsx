"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LEVELS } from "@/db/schema";
import type { Level } from "@/db/schema";
import { interestStyle, postJson } from "@/lib/ui";
import { Icon } from "./Icon";

export interface InterestConfig {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  isCustom: boolean;
  isFavorite: boolean;
  level: Level;
  enabled: boolean;
}

// Plain-language self-placement: what the reader would say about
// themselves, not jargon about the content.
const LEVEL_CHOICES: Record<Level, { label: string; hint: string }> = {
  new_to_this: { label: "New to it", hint: "Start from the ground up" },
  some_background: { label: "Know the basics", hint: "Skip the introductions" },
  advanced: { label: "Studying or working in it", hint: "Mechanisms and open questions" },
  research_level: { label: "Research level", hint: "Current debates and recent papers" },
};

const EMOJI: Record<string, string> = {
  neuroscience: "🧠",
  psychology: "💭",
  philosophy: "🏛️",
  history: "📜",
  economics: "📈",
  business: "💼",
  "political-science": "🗳️",
  "cs-ai": "🤖",
  physics: "⚛️",
  "critical-thinking": "🧐",
  "exercise-science": "🏃",
  "philosophy-of-science": "🔬",
  mathematics: "➗",
  logic: "🧩",
  "animal-world": "🦉",
  biology: "🧬",
  evolution: "🌱",
};

const MIN_ONBOARDING = 3;

export function InterestPicker({
  initial,
  mode,
  allowResearchLevel,
}: {
  initial: InterestConfig[];
  mode: "onboarding" | "settings";
  allowResearchLevel: boolean;
}) {
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");
  const [adding, setAdding] = useState(false);

  const enabledCount = list.filter((i) => i.enabled).length;
  const needMore = mode === "onboarding" && enabledCount < MIN_ONBOARDING;

  function update(id: number, patch: Partial<InterestConfig>) {
    setSaved(false);
    setList((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  async function addCustom(e: React.FormEvent) {
    e.preventDefault();
    const name = customName.trim();
    if (!name) return;
    setAdding(true);
    setError(null);
    const res = await postJson<InterestConfig>("/api/interests/custom", { name });
    if (res.ok && res.data) {
      const added = res.data;
      setList((prev) => (prev.some((i) => i.id === added.id) ? prev.map((i) => (i.id === added.id ? { ...i, enabled: true } : i)) : [...prev, { ...added, enabled: true }]));
      setCustomName("");
    } else setError(res.error);
    setAdding(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await postJson("/api/interests", {
      interests: list.map((i) => ({ interestId: i.id, level: i.level, enabled: i.enabled, isFavorite: i.isFavorite })),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (mode === "onboarding") {
      router.push("/");
      router.refresh();
    } else {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {list.map((i) => (
          <li key={i.id} style={interestStyle(i.id)}>
            <div className={`rounded-3xl border-2 p-4 transition ${i.enabled ? "border-[var(--ic)] bg-[var(--ic-soft)]" : "border-neuron-border bg-neuron-surface"}`}>
              <div className="flex items-start gap-2">
                <button type="button" onClick={() => update(i.id, { enabled: !i.enabled })} aria-pressed={i.enabled} className="flex min-h-[44px] flex-1 items-center gap-3 text-left">
                  <span aria-hidden className="text-2xl">
                    {EMOJI[i.slug] ?? "✨"}
                  </span>
                  <span>
                    <span className="block font-bold leading-tight">{i.name}</span>
                    {i.description && <span className="mt-0.5 block text-xs leading-snug text-neuron-muted">{i.description}</span>}
                  </span>
                  <span
                    aria-hidden
                    className={`ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${i.enabled ? "border-[var(--ic)] bg-[var(--ic)] text-white" : "border-neuron-border"}`}
                  >
                    {i.enabled && <Icon name="check" className="h-4 w-4" />}
                  </span>
                </button>
              </div>
              {i.enabled && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor={`level-${i.id}`}>
                    How much do you already know about {i.name}?
                  </label>
                  <select
                    id={`level-${i.id}`}
                    value={i.level}
                    onChange={(e) => update(i.id, { level: e.target.value as Level })}
                    className="min-h-[40px] flex-1 rounded-full border border-neuron-border bg-neuron-surface px-3 text-sm font-semibold text-neuron-text"
                  >
                    {LEVELS.map((l) => (
                      <option key={l} value={l} disabled={l === "research_level" && !allowResearchLevel}>
                        {LEVEL_CHOICES[l].label}
                        {l === "research_level" && !allowResearchLevel ? " (Pro)" : ` — ${LEVEL_CHOICES[l].hint}`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => update(i.id, { isFavorite: !i.isFavorite })}
                    aria-pressed={i.isFavorite}
                    aria-label={i.isFavorite ? `Remove ${i.name} from favourites` : `Mark ${i.name} as a favourite — see more of it`}
                    title="Favourite: see more of this, and get further ahead"
                    className={`flex h-10 w-10 items-center justify-center rounded-full border ${i.isFavorite ? "border-neuron-warn bg-neuron-warn/15 text-neuron-warn" : "border-neuron-border text-neuron-muted"}`}
                  >
                    <Icon name="star" filled={i.isFavorite} />
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      <form onSubmit={addCustom} className="mt-5 flex gap-2">
        <label htmlFor="custom-interest" className="sr-only">
          Add your own field
        </label>
        <input id="custom-interest" className="field" value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Something else? e.g. Volcanology" maxLength={60} />
        <button type="submit" className="btn-secondary shrink-0" disabled={adding || !customName.trim()}>
          {adding ? "Adding…" : "Add"}
        </button>
      </form>

      <div className={`sticky z-10 ${mode === "onboarding" ? "bottom-4" : "bottom-20 md:bottom-4"} mt-6 flex flex-wrap items-center gap-3 rounded-3xl border border-neuron-border bg-neuron-surface/95 p-3 backdrop-blur`}>
        <button type="button" className="btn-primary" onClick={save} disabled={saving || needMore || enabledCount === 0}>
          {saving ? "Saving…" : mode === "onboarding" ? "Start learning" : "Save interests"}
        </button>
        <p className="text-sm text-neuron-muted" aria-live="polite">
          {needMore ? `Pick at least ${MIN_ONBOARDING} — ${MIN_ONBOARDING - enabledCount} to go.` : saved ? "Saved." : `${enabledCount} selected`}
        </p>
        {error && <p className="error-text w-full">{error}</p>}
      </div>
    </div>
  );
}

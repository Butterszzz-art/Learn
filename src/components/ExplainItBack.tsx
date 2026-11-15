"use client";

import { useState } from "react";
import type { ExplainBackEntry } from "@/lib/content";
import { postJson } from "@/lib/ui";
import { ExportButtons } from "./ExportButtons";

type Source = { type: "deepDive"; id: number } | { type: "chapter"; id: number };

const RATING_NOTE: Record<NonNullable<ExplainBackEntry["rating"]>, string> = {
  gaps: "Some gaps — this will come back for review soon.",
  solid: "You've got the core of it.",
  teach: "Clear enough to teach someone else.",
};

/**
 * Explain the entry back in your own words and get specific, supportive
 * feedback. Never a score — but privately it updates how well the app
 * thinks you know these ideas, which sets when they come back for review.
 */
export function ExplainItBack({ source, prompt, initialEntries }: { source: Source; prompt: string; initialEntries: ExplainBackEntry[] }) {
  const [entries, setEntries] = useState(initialEntries);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    const res = await postJson<{ id: number; feedback: string; rating: ExplainBackEntry["rating"] }>(
      source.type === "deepDive" ? "/api/deep-dive/explain-back" : "/api/library/chapter/explain-back",
      source.type === "deepDive" ? { deepDiveId: source.id, explanation: trimmed } : { chapterId: source.id, explanation: trimmed }
    );
    if (res.ok && res.data) {
      setEntries((prev) => [{ id: res.data!.id, userExplanation: trimmed, feedback: res.data!.feedback, rating: res.data!.rating, createdAt: new Date().toISOString() }, ...prev]);
      setText("");
    } else setError(res.error);
    setBusy(false);
  }

  return (
    <section className="mt-10 border-t border-neuron-border pt-6" aria-labelledby="eib-heading">
      <h2 id="eib-heading" className="eyebrow mb-2">Explain it back</h2>
      <p className="mb-3 text-base font-semibold">{prompt}</p>
      <form onSubmit={submit}>
        <label htmlFor="eib-text" className="sr-only">Your explanation</label>
        <textarea id="eib-text" className="field" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write it as if you were explaining to a friend…" maxLength={6000} />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-secondary" disabled={busy || text.trim().length < 20}>
            {busy ? "Reading your explanation…" : "Get feedback"}
          </button>
          <span aria-live="polite">{error && <span className="error-text">{error}</span>}</span>
        </div>
      </form>
      {entries.length > 0 && (
        <ul className="mt-5 space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="card">
              <p className="whitespace-pre-line text-sm text-neuron-text/90">{entry.userExplanation}</p>
              <p className="mt-3 rounded-2xl bg-neuron-surface2 p-3 text-sm leading-relaxed">{entry.feedback}</p>
              {entry.rating && <p className="mt-2 text-xs font-bold text-neuron-accent3">{RATING_NOTE[entry.rating]}</p>}
              <div className="mt-3"><ExportButtons kind="explain-back" id={entry.id} /></div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

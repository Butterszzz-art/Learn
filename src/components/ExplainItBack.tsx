"use client";

import { useState } from "react";
import type { ExplainBackEntry } from "@/lib/digest";
import { ExportButtons } from "./ExportButtons";

type Source = { type: "deepDive"; id: number } | { type: "chapter"; id: number };

/** Retrieval practice via free-form writing: explain the content back in
 * your own words (or answer an essay prompt, for advanced/research_level
 * deep dives), get brief supportive feedback — never a score or grade.
 * Works for either a deep dive or a Library book chapter (Phase 7) — same
 * UI, different API endpoint underneath. Past attempts on this entry are
 * shown above the input, most recent first. */
export function ExplainItBack({
  source,
  prompt,
  initialEntries,
}: {
  source: Source;
  prompt: string;
  initialEntries: ExplainBackEntry[];
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const path = source.type === "deepDive" ? "/api/deep-dive/explain-back" : "/api/library/chapter/explain-back";
      const body =
        source.type === "deepDive"
          ? { deepDiveId: source.id, userExplanation: trimmed }
          : { chapterId: source.id, userExplanation: trimmed };
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't generate feedback");
      setEntries((prev) => [
        { id: data.id, userExplanation: trimmed, feedback: data.feedback, createdAt: new Date().toISOString() },
        ...prev,
      ]);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-10 border-t border-neuron-border pt-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neuron-muted">
        Explain it back
      </h2>
      <p className="mb-3 text-sm text-neuron-text/90">{prompt}</p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="Write your explanation here…"
        className="w-full rounded-2xl border border-neuron-border bg-neuron-surface2 px-3 py-2 text-sm text-neuron-text placeholder:text-neuron-muted focus:border-neuron-accent focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-3">
        <button type="button" className="btn-secondary" onClick={submit} disabled={submitting || !text.trim()}>
          {submitting ? "Getting feedback…" : "Submit"}
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>

      {entries.length > 0 && (
        <div className="mt-5 space-y-3">
          {entries.map((entry) => (
            <div key={entry.id} className="card">
              <p className="mb-2 text-sm text-neuron-text/90">{entry.userExplanation}</p>
              <p className="mb-3 text-xs leading-relaxed text-neuron-accent3">{entry.feedback}</p>
              <ExportButtons kind="explain-back" id={entry.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

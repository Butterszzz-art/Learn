"use client";

import { useEffect, useState } from "react";

interface SyllabusTopic {
  id: number;
  topic: string;
  reference: string | null;
  referenceYear: number | null;
}

interface Syllabus {
  id: number;
  interestId: number;
  name: string;
  uploadedAt: string;
  topics: SyllabusTopic[];
}

interface InterestOption {
  id: number;
  name: string;
}

/** Phase 15 (Syllabus Awareness) — per-interest syllabus/reading-list
 * upload and management. An interest can have multiple syllabi (multiple
 * courses within one major); each gets parsed into a topic list that later
 * steers Deep Dive topic selection and feeds the "Not in your syllabus" /
 * "Newer than your assigned reading" feed labels. */
export function SyllabusManager({ interests }: { interests: InterestOption[] }) {
  const [interestId, setInterestId] = useState<number | "">(interests[0]?.id ?? "");
  const [syllabiList, setSyllabiList] = useState<Syllabus[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [rawContent, setRawContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (interestId === "") {
      setSyllabiList([]);
      return;
    }
    setLoading(true);
    fetch(`/api/syllabi?interestId=${interestId}`)
      .then((res) => res.json())
      .then((data) => setSyllabiList(Array.isArray(data) ? data : []))
      .catch(() => setSyllabiList([]))
      .finally(() => setLoading(false));
  }, [interestId]);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => setRawContent(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  async function addSyllabus() {
    if (interestId === "" || !rawContent.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/syllabi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interestId, name, rawContent }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't parse this syllabus");
      setSyllabiList((prev) => [...prev, data]);
      setName("");
      setRawContent("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function removeSyllabus(id: number) {
    setSyllabiList((prev) => prev.filter((s) => s.id !== id));
    await fetch(`/api/syllabi/${id}`, { method: "DELETE" }).catch(() => {});
  }

  function toggleExpanded(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (interests.length === 0) {
    return <p className="text-sm text-neuron-muted">Enable an interest first to attach a syllabus to it.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-neuron-muted">Course/interest</label>
        <select
          value={interestId}
          onChange={(e) => setInterestId(Number(e.target.value))}
          className="rounded-2xl border border-neuron-border bg-neuron-surface2 px-3 py-1.5 text-sm text-neuron-text focus:border-neuron-accent focus:outline-none"
        >
          {interests.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="text-xs text-neuron-muted">Loading…</p>}

      {!loading && syllabiList.length > 0 && (
        <div className="space-y-2">
          {syllabiList.map((s) => (
            <div key={s.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-neuron-muted">{s.topics.length} topic(s) parsed</p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <button type="button" className="text-neuron-accent hover:underline" onClick={() => toggleExpanded(s.id)}>
                    {expanded.has(s.id) ? "Hide topics" : "Show topics"}
                  </button>
                  <button type="button" className="text-red-400 hover:underline" onClick={() => removeSyllabus(s.id)}>
                    Remove
                  </button>
                </div>
              </div>
              {expanded.has(s.id) && (
                <ul className="mt-3 space-y-1 border-t border-neuron-border pt-3 text-xs text-neuron-muted">
                  {s.topics.map((t) => (
                    <li key={t.id}>
                      <span className="text-neuron-text/90">{t.topic}</span>
                      {t.reference && (
                        <span>
                          {" "}
                          — {t.reference}
                          {t.referenceYear ? ` (${t.referenceYear})` : ""}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neuron-muted">
          Add a syllabus or reading list
        </p>
        <div className="space-y-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='e.g. "PSYC301 - Cognitive Psychology"'
            className="w-full rounded-2xl border border-neuron-border bg-neuron-surface2 px-3 py-2 text-sm text-neuron-text placeholder:text-neuron-muted focus:border-neuron-accent focus:outline-none"
          />
          <textarea
            value={rawContent}
            onChange={(e) => setRawContent(e.target.value)}
            rows={5}
            placeholder="Paste the syllabus or reading list text here…"
            className="w-full rounded-2xl border border-neuron-border bg-neuron-surface2 px-3 py-2 text-sm text-neuron-text placeholder:text-neuron-muted focus:border-neuron-accent focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".txt,.md,text/plain,text/markdown"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
              className="text-xs text-neuron-muted file:mr-3 file:rounded-full file:border-0 file:bg-neuron-surface2 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-neuron-text hover:file:bg-neuron-border"
            />
            <span className="text-xs text-neuron-muted">or paste text above (plain text/markdown only)</span>
          </div>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={addSyllabus}
            disabled={saving || interestId === "" || !rawContent.trim()}
          >
            {saving ? "Parsing…" : "Add syllabus"}
          </button>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <p className="mt-3 text-xs text-neuron-muted">
          Parsed into a topic list, with any specific assigned readings and their publication years —
          used to steer Deep Dive topics toward genuine gaps in your coursework and to flag when a Deep
          Dive updates something your syllabus assigned an older reading on.
        </p>
      </div>
    </div>
  );
}

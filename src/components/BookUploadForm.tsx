"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "uploading" | "structure" | "chapters" | "done" | "error";

/** Upload a PDF, then drive its processing loop client-side — same
 * granular-per-step pattern as RefreshButton.tsx's deep-dive loop, since a
 * whole book (structure pass + one call per chapter) can take minutes and
 * would blow past a single serverless request's time limit. */
export function BookUploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [paceWeeks, setPaceWeeks] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progressLabel, setProgressLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleUpload() {
    if (!file) return;
    setError(null);
    setPhase("uploading");
    setProgressLabel("Uploading…");

    try {
      const form = new FormData();
      form.append("file", file);
      if (paceWeeks.trim()) form.append("paceWeeks", paceWeeks.trim());

      const uploadRes = await fetch("/api/library/upload", { method: "POST", body: form });
      const uploadData = await uploadRes.json().catch(() => null);
      if (!uploadRes.ok) throw new Error(uploadData?.error ?? "Upload failed");
      const bookId: number = uploadData.id;

      router.refresh(); // book now shows up in the list below, status "processing"

      setPhase("structure");
      setProgressLabel("Reading the book's structure…");
      const structRes = await fetch(`/api/library/${bookId}/process-structure`, { method: "POST" });
      const structData = await structRes.json().catch(() => null);
      if (!structRes.ok) throw new Error(structData?.error ?? "Structure processing failed");
      if (structData.status === "error") {
        setPhase("error");
        setError(structData.errorMessage || "Couldn't process this book.");
        router.refresh();
        return;
      }

      const totalChapters: number = structData.totalChapters;
      setPhase("chapters");
      for (let i = 0; i < totalChapters; i++) {
        setProgressLabel(`Processing chapter ${i + 1} of ${totalChapters}…`);
        const chRes = await fetch(`/api/library/${bookId}/process-chapter`, { method: "POST" });
        const chData = await chRes.json().catch(() => null);
        if (!chRes.ok) throw new Error(chData?.error ?? "Chapter processing failed");
        if (chData.done) break;
      }

      setPhase("done");
      setProgressLabel("Ready!");
      setFile(null);
      setPaceWeeks("");
      router.refresh();
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  const busy = phase === "uploading" || phase === "structure" || phase === "chapters";

  return (
    <div className="card">
      <p className="mb-3 font-medium">📖 Upload a book (PDF)</p>
      <div className="space-y-3">
        <input
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={busy}
          className="block w-full text-sm text-neuron-muted file:mr-3 file:rounded-full file:border-0 file:bg-neuron-surface2 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-neuron-text hover:file:bg-neuron-border"
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-neuron-muted">Finish in about</label>
          <input
            type="number"
            min={1}
            value={paceWeeks}
            onChange={(e) => setPaceWeeks(e.target.value)}
            disabled={busy}
            placeholder="4"
            className="w-16 rounded-2xl border border-neuron-border bg-neuron-surface2 px-2 py-1 text-sm text-neuron-text focus:border-neuron-accent focus:outline-none"
          />
          <span className="text-xs text-neuron-muted">weeks (skip for 1 chapter/cycle)</span>
        </div>
        <button type="button" className="btn-primary" onClick={handleUpload} disabled={!file || busy}>
          {busy ? progressLabel || "Working…" : "Upload & process"}
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {phase === "done" && <p className="text-xs text-neuron-accent3">✓ Book is ready — see it below.</p>}
      </div>
    </div>
  );
}

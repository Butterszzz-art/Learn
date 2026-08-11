"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "uploading" | "structure" | "chapters" | "done" | "error";
type InputMode = "file" | "url";

/** Upload a PDF/EPUB or paste an article URL, then drive its processing
 * loop client-side — same granular-per-step pattern as RefreshButton.tsx's
 * deep-dive loop, since a whole book (structure pass + one call per
 * chapter) can take minutes and would blow past a single serverless
 * request's time limit. */
export function BookUploadForm() {
  const router = useRouter();
  const [mode, setMode] = useState<InputMode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [paceWeeks, setPaceWeeks] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progressLabel, setProgressLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleUpload() {
    if (mode === "file" && !file) return;
    if (mode === "url" && !url.trim()) return;
    setError(null);
    setPhase("uploading");
    setProgressLabel(mode === "url" ? "Fetching…" : "Uploading…");

    try {
      const form = new FormData();
      if (mode === "file" && file) form.append("file", file);
      if (mode === "url") form.append("url", url.trim());
      if (paceWeeks.trim()) form.append("paceWeeks", paceWeeks.trim());

      const uploadRes = await fetch("/api/library/upload", { method: "POST", body: form });
      const uploadData = await uploadRes.json().catch(() => null);
      if (!uploadRes.ok) throw new Error(uploadData?.error ?? "Upload failed");
      const bookId: number = uploadData.id;

      router.refresh(); // book now shows up in the list below, status "processing"

      setPhase("structure");
      setProgressLabel(mode === "url" ? "Reading the article…" : "Reading the book's structure…");
      const structRes = await fetch(`/api/library/${bookId}/process-structure`, { method: "POST" });
      const structData = await structRes.json().catch(() => null);
      if (!structRes.ok) throw new Error(structData?.error ?? "Structure processing failed");
      if (structData.status === "error") {
        setPhase("error");
        setError(structData.errorMessage || "Couldn't process this.");
        router.refresh();
        return;
      }

      const totalChapters: number = structData.totalChapters;
      setPhase("chapters");
      for (let i = 0; i < totalChapters; i++) {
        setProgressLabel(
          totalChapters > 1 ? `Processing chapter ${i + 1} of ${totalChapters}…` : "Processing…"
        );
        const chRes = await fetch(`/api/library/${bookId}/process-chapter`, { method: "POST" });
        const chData = await chRes.json().catch(() => null);
        if (!chRes.ok) throw new Error(chData?.error ?? "Chapter processing failed");
        if (chData.done) break;
      }

      setPhase("done");
      setProgressLabel("Ready!");
      setFile(null);
      setUrl("");
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
      <p className="mb-3 font-medium">📖 Add to your Library</p>

      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => setMode("file")}
          disabled={busy}
          className={mode === "file" ? "nav-link-active" : "nav-link"}
        >
          Upload a file
        </button>
        <button
          type="button"
          onClick={() => setMode("url")}
          disabled={busy}
          className={mode === "url" ? "nav-link-active" : "nav-link"}
        >
          Paste a URL
        </button>
      </div>

      <div className="space-y-3">
        {mode === "file" ? (
          <>
            <input
              type="file"
              accept="application/pdf,.pdf,application/epub+zip,.epub"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={busy}
              className="block w-full text-sm text-neuron-muted file:mr-3 file:rounded-full file:border-0 file:bg-neuron-surface2 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-neuron-text hover:file:bg-neuron-border"
            />
            <p className="text-xs text-neuron-muted">PDF or EPUB, up to 32MB.</p>
          </>
        ) : (
          <>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
              placeholder="https://example.com/a-good-article"
              className="w-full rounded-2xl border border-neuron-border bg-neuron-surface2 px-3 py-2 text-sm text-neuron-text placeholder:text-neuron-muted focus:border-neuron-accent focus:outline-none"
            />
            <p className="text-xs text-neuron-muted">
              A single article becomes a one-chapter notebook entry, using its own title.
            </p>
          </>
        )}

        {mode === "file" && (
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
        )}

        <button
          type="button"
          className="btn-primary"
          onClick={handleUpload}
          disabled={(mode === "file" ? !file : !url.trim()) || busy}
        >
          {busy ? progressLabel || "Working…" : mode === "url" ? "Fetch & process" : "Upload & process"}
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {phase === "done" && <p className="text-xs text-neuron-accent3">✓ Ready — see it below.</p>}
      </div>
    </div>
  );
}

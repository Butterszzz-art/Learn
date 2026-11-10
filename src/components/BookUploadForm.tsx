"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "file" | "url";

/**
 * Upload a PDF/EPUB or paste an article link. Processing runs as queued
 * background jobs (one per chapter); this form just watches progress, so
 * closing the page doesn't stop it.
 */
export function BookUploadForm({ canUpload, limitMessage }: { canUpload: boolean; limitMessage: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [paceWeeks, setPaceWeeks] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  function watch(bookId: number) {
    const kick = () => fetch("/api/jobs/kick", { method: "POST" }).catch(() => {});
    kick();
    let ticks = 0;
    timer.current = setInterval(async () => {
      ticks++;
      const s = await fetch(`/api/library/${bookId}/status`).then((r) => r.json()).catch(() => null);
      if (!s) return;
      if (s.status === "error") {
        clearInterval(timer.current!);
        setError(s.errorMessage ?? "This couldn't be processed.");
        setProgress(null);
        setBusy(false);
        router.refresh();
      } else if (s.status === "ready") {
        clearInterval(timer.current!);
        setProgress(null);
        setBusy(false);
        router.refresh();
      } else {
        setProgress(s.totalChapters > 0 ? `Writing chapter notes: ${s.chaptersProcessed} of ${s.totalChapters} done. You can leave this page.` : "Reading the structure…");
        if (ticks % 3 === 0) { kick(); router.refresh(); }
      }
    }, 5000);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "file" ? !file : !url.trim()) return;
    setBusy(true);
    setError(null);
    setProgress(mode === "url" ? "Fetching the article…" : "Uploading…");
    try {
      const form = new FormData();
      if (mode === "file" && file) form.append("file", file);
      if (mode === "url") form.append("url", url.trim());
      if (paceWeeks.trim()) form.append("paceWeeks", paceWeeks.trim());
      const res = await fetch("/api/library/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Upload failed");
      setFile(null);
      setUrl("");
      router.refresh();
      watch(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setProgress(null);
      setBusy(false);
    }
  }

  if (!canUpload) return <p className="card text-sm text-neuron-muted">{limitMessage}</p>;

  return (
    <form onSubmit={submit} className="card">
      <div className="mb-4 flex gap-2" role="tablist" aria-label="What to add">
        {(["file", "url"] as Mode[]).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`pill !py-1.5 ${mode === m ? "!border-neuron-accent !bg-neuron-accent/15 !text-neuron-text" : ""}`}>
            {m === "file" ? "PDF or EPUB" : "Article link"}
          </button>
        ))}
      </div>
      {mode === "file" ? (
        <div>
          <label htmlFor="book-file" className="label">Choose a file (up to 32MB)</label>
          <input id="book-file" type="file" accept=".pdf,.epub,application/pdf,application/epub+zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-neuron-muted file:mr-3 file:rounded-full file:border-0 file:bg-neuron-surface2 file:px-4 file:py-2.5 file:font-bold file:text-neuron-text" />
        </div>
      ) : (
        <div>
          <label htmlFor="book-url" className="label">Link to an article</label>
          <input id="book-url" type="url" inputMode="url" className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </div>
      )}
      {mode === "file" && (
        <div className="mt-4">
          <label htmlFor="book-pace" className="label">Finish it in about how many weeks? <span className="font-normal text-neuron-muted">(optional)</span></label>
          <input id="book-pace" type="number" min={1} max={104} inputMode="numeric" className="field max-w-[10rem]" value={paceWeeks} onChange={(e) => setPaceWeeks(e.target.value)} placeholder="e.g. 6" />
        </div>
      )}
      <p className="mt-4 text-xs text-neuron-muted">Only add material you have the right to use for your own study. It stays private to you.</p>
      <button type="submit" className="btn-primary mt-4" disabled={busy || (mode === "file" ? !file : !url.trim())}>
        {busy ? "Working…" : "Add to my library"}
      </button>
      <div aria-live="polite">
        {progress && <p className="mt-3 text-sm text-neuron-muted">{progress}</p>}
        {error && <p className="error-text mt-3">{error}</p>}
      </div>
    </form>
  );
}

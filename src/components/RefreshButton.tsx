"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setStatus("Fetching new items…");
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Refresh failed");

      if (data.noNewItems) {
        setStatus(`No new items found (checked ${data.fetchedCount} fetched).`);
      } else {
        setStatus(
          `Added ${data.itemCount} items to the digest` +
            (data.usedClaude ? "" : " (keyword mode — no API key set)") +
            "."
        );
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button className="btn-primary" onClick={handleClick} disabled={isPending || status === "Fetching new items…"}>
        {status === "Fetching new items…" || isPending ? (
          <>
            <Spinner /> Refreshing…
          </>
        ) : (
          <>↻ Refresh now</>
        )}
      </button>
      {status && status !== "Fetching new items…" && (
        <p className="max-w-xs text-right text-xs text-brain-muted">{status}</p>
      )}
      {error && <p className="max-w-xs text-right text-xs text-red-400">{error}</p>}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

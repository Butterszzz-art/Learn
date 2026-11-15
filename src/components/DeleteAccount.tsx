"use client";

import { useState } from "react";

export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    if (res.ok) {
      window.location.assign("/welcome");
      return;
    }
    const data = await res.json().catch(() => null);
    setError(data?.error ?? "Couldn't delete the account.");
    setBusy(false);
  }

  if (!open) {
    return (
      <button type="button" className="btn-ghost !text-neuron-danger" onClick={() => setOpen(true)}>
        Delete my account
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="rounded-3xl border-2 border-neuron-danger/40 p-5">
      <p className="font-bold">Delete your account?</p>
      <p className="mt-1 text-sm text-neuron-muted">
        This permanently removes your progress, knowledge map, saved cards, Library books and everything you've written. It can't be undone.
      </p>
      <label htmlFor="delete-password" className="label mt-4">Enter your password to confirm</label>
      <input id="delete-password" type="password" autoComplete="current-password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <div aria-live="polite">{error && <p className="error-text mt-2">{error}</p>}</div>
      <div className="mt-4 flex gap-2">
        <button type="submit" className="btn-secondary !border-neuron-danger !text-neuron-danger" disabled={busy || !password}>{busy ? "Deleting…" : "Delete permanently"}</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

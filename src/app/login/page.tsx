"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Login failed");
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-6">
      <h1 className="mb-2 font-display text-2xl font-bold">
        <span className="bg-gradient-to-r from-neuron-accent to-neuron-accent2 bg-clip-text text-transparent">
          🧠 Neuron
        </span>
      </h1>
      <p className="mb-6 text-sm text-neuron-muted">Enter the passphrase to continue.</p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          placeholder="Passphrase"
          className="w-full rounded-2xl border border-neuron-border bg-neuron-surface2 px-3 py-2 text-sm text-neuron-text placeholder:text-neuron-muted focus:border-neuron-accent focus:outline-none"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button type="submit" className="btn-primary w-full justify-center" disabled={loading || !password}>
          {loading ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}

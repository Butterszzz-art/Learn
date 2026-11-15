"use client";

import { useState } from "react";
import Link from "next/link";
import { postJson } from "@/lib/ui";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await postJson(`/api/auth/${mode}`, { email, password });
    if (res.ok) {
      // A full navigation, so the new session cookie is used for the first render.
      window.location.assign("/");
      return;
    }
    setError(res.error);
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="card mx-auto mt-10 max-w-md" noValidate>
      <p className="text-center text-4xl" aria-hidden>
        🧠
      </p>
      <h1 className="page-title mt-2 text-center">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
      <p className="mt-1 text-center text-sm text-neuron-muted">
        {mode === "login" ? "Pick up where you left off." : "Free to start. No card needed."}
      </p>

      <div className="mt-6">
        <label htmlFor="email" className="label">
          Email
        </label>
        <input id="email" type="email" autoComplete="email" inputMode="email" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="mt-4">
        <label htmlFor="password" className="label">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          minLength={8}
          className="field"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby={mode === "signup" ? "password-hint" : undefined}
        />
        {mode === "signup" && (
          <p id="password-hint" className="mt-1.5 text-xs text-neuron-muted">
            At least 8 characters.
          </p>
        )}
      </div>

      {mode === "signup" && (
        <label className="mt-4 flex items-start gap-3 text-sm text-neuron-muted">
          <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[rgb(var(--n-accent))]" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>
            I'm 13 or older and agree to the{" "}
            <Link href="/terms" className="font-bold text-neuron-accent">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="font-bold text-neuron-accent">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
      )}

      <div aria-live="polite">{error && <p className="error-text mt-4">{error}</p>}</div>

      <button type="submit" className="btn-primary mt-6 w-full" disabled={busy || !email || !password || (mode === "signup" && !agreed)}>
        {busy ? "One moment…" : mode === "login" ? "Sign in" : "Create account"}
      </button>

      <p className="mt-5 text-center text-sm text-neuron-muted">
        {mode === "login" ? (
          <>
            New here?{" "}
            <Link href="/signup" className="font-bold text-neuron-accent">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-bold text-neuron-accent">
              Sign in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

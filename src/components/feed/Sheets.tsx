"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { FeedCard } from "@/lib/cardTypes";
import { postJson } from "@/lib/ui";
import { Icon } from "../Icon";
import { Markdown } from "../Markdown";

/** Bottom sheet: focus is moved in, Escape and the backdrop close it. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="sheet outline-none">
        <div className="flex items-center justify-between gap-3 border-b border-neuron-border px-5 py-3">
          <h2 className="truncate font-display text-lg font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="btn-ghost !min-h-[40px] !px-2">
            <Icon name="close" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
          {children}
        </div>
      </div>
    </>
  );
}

interface DeepDivePreview {
  id: number;
  topic: string;
  content: string;
  interestName: string;
  takeaways: string[];
  sources: { title: string; url: string }[];
}

/** "Go deeper": the full entry behind a bite, layered — key points first. */
export function DeepDiveSheet({ deepDiveId, onClose }: { deepDiveId: number; onClose: () => void }) {
  const [data, setData] = useState<DeepDivePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deep-dive/${deepDiveId}`)
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (cancelled) return;
        if (!r.ok) setError(j?.error ?? "Couldn't load this entry.");
        else setData(j);
      })
      .catch(() => !cancelled && setError("You appear to be offline."));
    return () => {
      cancelled = true;
    };
  }, [deepDiveId]);

  return (
    <Sheet title={data?.topic ?? "Loading…"} onClose={onClose}>
      {error && <p className="error-text">{error}</p>}
      {!data && !error && <p className="text-neuron-muted" role="status">Loading…</p>}
      {data && (
        <>
          <p className="eyebrow">{data.interestName}</p>
          {data.takeaways.length > 0 && (
            <ul className="mb-5 mt-3 space-y-2 rounded-2xl bg-neuron-surface2 p-4">
              {data.takeaways.map((t) => (
                <li key={t} className="flex gap-2 text-[15px] font-semibold leading-snug">
                  <span aria-hidden className="text-neuron-accent">•</span>
                  {t}
                </li>
              ))}
            </ul>
          )}
          <Markdown>{data.content}</Markdown>
          {data.sources.length > 0 && (
            <div className="mt-6 border-t border-neuron-border pt-4">
              <p className="eyebrow mb-2">Sources</p>
              <ul className="space-y-1.5 text-sm">
                {data.sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-neuron-accent">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Link href={`/deep-dive/${data.id}`} className="btn-primary mt-6 w-full">
            Open full page — quiz, explain-it-back, what's next
          </Link>
        </>
      )}
    </Sheet>
  );
}

interface Turn {
  role: "user" | "assistant";
  content: string;
}

/** Ask a question about one card (or one deep dive). */
export function AskSheet({ card, deepDiveId, onClose }: { card?: FeedCard; deepDiveId?: number; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setText("");
    const history = turns;
    setTurns([...history, { role: "user", content: q }]);
    const res = await postJson<{ answer: string }>("/api/ask", { cardId: card?.cardId ?? undefined, deepDiveId, question: q, history });
    if (res.ok && res.data) setTurns((t) => [...t, { role: "assistant", content: res.data!.answer }]);
    else setError(res.error);
    setBusy(false);
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end" }));
  }

  const starters = ["Explain this more simply", "Give me a real-world example", "Why does this matter?"];

  return (
    <Sheet title="Ask about this" onClose={onClose}>
      {card && <p className="mb-4 rounded-2xl bg-neuron-surface2 p-3 text-sm font-semibold">{card.title}</p>}
      <div className="space-y-3" aria-live="polite">
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "ml-8 rounded-2xl bg-neuron-accent/15 p-3 text-[15px]" : "mr-4 whitespace-pre-line rounded-2xl bg-neuron-surface2 p-3 text-[15px] leading-relaxed"}>
            {t.content}
          </div>
        ))}
        {busy && <p className="text-sm text-neuron-muted" role="status">Thinking…</p>}
        {error && <p className="error-text">{error}</p>}
      </div>
      {turns.length === 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {starters.map((s) => (
            <button key={s} type="button" className="pill !text-neuron-text hover:border-neuron-accent" onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <label htmlFor="ask-input" className="sr-only">
          Your question
        </label>
        <input id="ask-input" className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a question…" maxLength={1000} autoComplete="off" />
        <button type="submit" className="btn-primary" disabled={busy || !text.trim()}>
          Ask
        </button>
      </form>
      <p className="mt-3 text-xs text-neuron-muted">Answers are AI-generated from this entry and its sources. Check anything important against the sources.</p>
      <div ref={endRef} />
    </Sheet>
  );
}

/** Report a mistake or a problem with a card. */
export function ReportSheet({ card, deepDiveId, onClose }: { card?: FeedCard; deepDiveId?: number; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const res = await postJson("/api/report", { cardId: card?.cardId ?? undefined, deepDiveId, reason });
    if (res.ok) setState("done");
    else {
      setError(res.error);
      setState("idle");
    }
  }
  return (
    <Sheet title="Report a problem" onClose={onClose}>
      {state === "done" ? (
        <p className="text-base">Thanks — this goes to a person to check. Cards reported by several readers are hidden until they've been reviewed.</p>
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="report-reason" className="label">
            What's wrong with it?
          </label>
          <textarea
            id="report-reason"
            className="field"
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. The number in the second sentence doesn't match the source."
            maxLength={1000}
            required
          />
          {error && <p className="error-text mt-2">{error}</p>}
          <button type="submit" className="btn-primary mt-4" disabled={state === "sending" || reason.trim().length < 3}>
            {state === "sending" ? "Sending…" : "Send report"}
          </button>
        </form>
      )}
    </Sheet>
  );
}

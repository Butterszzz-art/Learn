"use client";

import { useRef, useState } from "react";

interface Paper {
  externalId: string;
  source: "openalex" | "semantic_scholar";
  title: string;
  abstract: string | null;
  authors: string[];
  doi: string | null;
  url: string | null;
  openAccessPdfUrl: string | null;
  publishedDate: string | null;
  venue: string | null;
  citationCount: number | null;
  fieldsOfStudy: string[];
}

interface ResearchResult {
  answer: string;
  papers: Paper[];
}

// One accent per source, reusing the app's existing palette (no new colors)
// so a reader can tell the two providers apart at a glance.
const SOURCE_STYLE: Record<
  Paper["source"],
  { label: string; dot: string; text: string; border: string; hoverBorder: string }
> = {
  openalex: {
    label: "OpenAlex",
    dot: "bg-neuron-accent3",
    text: "text-neuron-accent3",
    border: "border-neuron-accent3/30",
    hoverBorder: "hover:border-neuron-accent3/70",
  },
  semantic_scholar: {
    label: "Semantic Scholar",
    dot: "bg-neuron-accent2",
    text: "text-neuron-accent2",
    border: "border-neuron-accent2/30",
    hoverBorder: "hover:border-neuron-accent2/70",
  },
};

// A few concrete starting points, not generic filler — cuts the "blank box"
// friction on first use without auto-submitting (and spending an API call)
// on the user's behalf.
const EXAMPLE_QUESTIONS = [
  "How effective are GLP-1 drugs for conditions beyond diabetes?",
  "What's the current evidence on microplastics and human health?",
  "Is spaced repetition actually better than massed practice for long-term retention?",
  "What do we know about the gut microbiome's role in mood disorders?",
];

/**
 * The Research Agent (add-on feature) — a text box that hands a question to
 * an OpenRouter-backed agent, which searches OpenAlex + Semantic Scholar for
 * real papers before answering. Independent of the rest of the app's
 * Anthropic-powered generation; disabled gracefully if OPENROUTER_API_KEY
 * isn't set (the API route returns a 501 with an explanatory message).
 */
export function ResearchAgent() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setCopied(false);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Research Agent failed.");
        return;
      }
      setResult(data as ResearchResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Research Agent failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    ask(question);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      ask(question);
    }
  }

  function handleExampleClick(example: string) {
    setQuestion(example);
    textareaRef.current?.focus();
  }

  async function handleCopy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission denied or unavailable — fail silently, the
      // answer text is still selectable/readable on screen.
    }
  }

  function handleReset() {
    setResult(null);
    setError(null);
    setQuestion("");
    textareaRef.current?.focus();
  }

  const showEmptyState = !loading && !error && !result;

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} className="card space-y-3">
        <label htmlFor="research-question" className="text-sm font-semibold text-neuron-text">
          Ask a research question
        </label>
        <textarea
          id="research-question"
          ref={textareaRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about any topic in the current literature…"
          rows={3}
          className="w-full resize-none rounded-2xl border border-neuron-border bg-neuron-surface2 p-3 text-sm text-neuron-text placeholder:text-neuron-muted focus:outline-none focus:ring-2 focus:ring-neuron-accent/50"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-neuron-muted">
            <kbd className="rounded border border-neuron-border bg-neuron-surface2 px-1.5 py-0.5 font-sans text-[10px]">
              ⌘
            </kbd>{" "}
            +{" "}
            <kbd className="rounded border border-neuron-border bg-neuron-surface2 px-1.5 py-0.5 font-sans text-[10px]">
              Enter
            </kbd>{" "}
            to ask
          </p>
          <button type="submit" className="btn-primary" disabled={loading || !question.trim()}>
            {loading ? (
              <>
                <Spinner /> Searching real papers…
              </>
            ) : (
              <>
                <SearchIcon /> Ask
              </>
            )}
          </button>
        </div>
      </form>

      {showEmptyState && (
        <div className="animate-reveal">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neuron-muted">
            Or try one of these
          </p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_QUESTIONS.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => handleExampleClick(example)}
                className="rounded-full border border-neuron-border bg-neuron-surface px-3 py-1.5 text-left text-xs text-neuron-muted transition hover:border-neuron-accent/60 hover:text-neuron-text"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && <ResultSkeleton />}

      {error && (
        <div className="animate-reveal card flex items-start gap-3 border-red-500/40 bg-red-500/5">
          <AlertIcon />
          <div className="flex-1 space-y-2">
            <p className="text-sm text-red-300">{error}</p>
            <button
              type="button"
              onClick={() => ask(question)}
              className="text-xs font-semibold text-red-300 hover:underline"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="animate-reveal space-y-4">
          <div className="card space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="pill">Answer</span>
              <div className="flex items-center gap-3">
                {copied && <span className="text-xs text-neuron-accent3">Copied</span>}
                <button
                  type="button"
                  onClick={handleCopy}
                  aria-label="Copy answer"
                  className="text-neuron-muted transition hover:text-neuron-text"
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-neuron-text/90">
              {result.answer}
            </p>
          </div>

          {result.papers.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-neuron-muted">
                  Sources ({result.papers.length})
                </p>
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-xs font-semibold text-neuron-accent hover:underline"
                >
                  Ask something else
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {result.papers.map((p, i) => {
                  const style = SOURCE_STYLE[p.source];
                  return (
                    <a
                      key={p.externalId}
                      href={p.url ?? p.openAccessPdfUrl ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
                      className={`animate-reveal group flex flex-col rounded-2xl border bg-neuron-surface p-3 transition hover:-translate-y-1 hover:shadow-lg hover:shadow-black/20 ${style.border} ${style.hoverBorder}`}
                    >
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${style.text}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                          {style.label}
                        </span>
                        <ExternalLinkIcon className="shrink-0 text-neuron-muted transition group-hover:text-neuron-text" />
                      </div>
                      <span className="text-sm font-medium leading-snug text-neuron-text">{p.title}</span>
                      <p className="mt-1 text-xs text-neuron-muted">
                        {[
                          p.authors.slice(0, 3).join(", ") + (p.authors.length > 3 ? " et al." : ""),
                          p.venue,
                          p.publishedDate?.slice(0, 4),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {(p.citationCount !== null && p.citationCount > 0) || p.fieldsOfStudy.length > 0 ? (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {p.citationCount !== null && p.citationCount > 0 && (
                            <span className="pill py-0.5 text-[10px]">
                              {p.citationCount.toLocaleString()} citation{p.citationCount === 1 ? "" : "s"}
                            </span>
                          )}
                          {p.fieldsOfStudy.slice(0, 2).map((field) => (
                            <span key={field} className="pill py-0.5 text-[10px]">
                              {field}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Loading placeholder shaped like the real answer + source cards, so the
 * layout doesn't jump once results land — filling the ~10-20s search+answer
 * round trip with something more informative than a bare spinner. */
function ResultSkeleton() {
  return (
    <div className="animate-reveal space-y-4" aria-hidden="true">
      <div className="card space-y-2.5">
        <div className="h-4 w-16 animate-pulse rounded-full bg-neuron-surface2" />
        <div className="h-3 w-full animate-pulse rounded bg-neuron-surface2" />
        <div className="h-3 w-11/12 animate-pulse rounded bg-neuron-surface2" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-neuron-surface2" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-2 rounded-2xl border border-neuron-border bg-neuron-surface p-3">
            <div className="h-3 w-20 animate-pulse rounded-full bg-neuron-surface2" />
            <div className="h-3.5 w-full animate-pulse rounded bg-neuron-surface2" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-neuron-surface2" />
          </div>
        ))}
      </div>
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

function SearchIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25">
      <circle cx="11" cy="11" r="7" strokeLinecap="round" />
      <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
    </svg>
  );
}

function ExternalLinkIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={`h-3.5 w-3.5 ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M7 17L17 7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 7h9v9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M4 16V5a1 1 0 011-1h11" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4 text-neuron-accent3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25">
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg className="h-4 w-4 shrink-0 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" strokeLinecap="round" />
      <circle cx="12" cy="16" r="0.5" fill="currentColor" />
    </svg>
  );
}

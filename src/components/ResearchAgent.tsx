"use client";

import { useState } from "react";

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

const SOURCE_LABELS: Record<Paper["source"], string> = {
  openalex: "OpenAlex",
  semantic_scholar: "Semantic Scholar",
};

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);
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

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} className="card space-y-3">
        <label htmlFor="research-question" className="text-sm font-semibold text-neuron-text">
          Ask a research question
        </label>
        <textarea
          id="research-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. What does recent evidence say about sleep's role in memory consolidation?"
          rows={3}
          className="w-full resize-none rounded-2xl border border-neuron-border bg-neuron-surface2 p-3 text-sm text-neuron-text placeholder:text-neuron-muted focus:outline-none focus:ring-2 focus:ring-neuron-accent/50"
        />
        <button type="submit" className="btn-primary" disabled={loading || !question.trim()}>
          {loading ? "Searching real papers…" : "🔬 Ask"}
        </button>
      </form>

      {error && (
        <div className="card border-red-500/40 bg-red-500/5 text-sm text-red-300">{error}</div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="card">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-neuron-text/90">
              {result.answer}
            </p>
          </div>

          {result.papers.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neuron-muted">
                Sources ({result.papers.length})
              </p>
              <div className="space-y-2">
                {result.papers.map((p) => (
                  <a
                    key={p.externalId}
                    href={p.url ?? p.openAccessPdfUrl ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-2xl border border-neuron-border bg-neuron-surface p-3 transition hover:border-neuron-accent/60"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium leading-snug">{p.title}</span>
                      <span className="pill shrink-0">{SOURCE_LABELS[p.source]}</span>
                    </div>
                    <p className="mt-1 text-xs text-neuron-muted">
                      {[
                        p.authors.slice(0, 3).join(", ") + (p.authors.length > 3 ? " et al." : ""),
                        p.venue,
                        p.publishedDate?.slice(0, 4),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

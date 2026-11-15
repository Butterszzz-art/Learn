"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SearchContentType } from "@/lib/searchTypes";
import { SEARCH_CONTENT_TYPE_ICONS, SEARCH_CONTENT_TYPE_LABELS } from "@/lib/searchTypes";
import { Icon } from "./Icon";

interface Result { contentType: SearchContentType; sourceId: number; title: string; snippet: string; interestLabel: string; url: string }

/** Search everything you can read: shared entries, plus your own Library and writing. */
export function SearchBox() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => setResults(d.results ?? []))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 220);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  return (
    <div>
      <div className="relative">
        <label htmlFor="search" className="sr-only">Search</label>
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neuron-muted"><Icon name="search" /></span>
        <input id="search" ref={inputRef} type="search" className="field !pl-11" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search topics, concepts, your notes…" autoComplete="off" />
      </div>
      <div aria-live="polite">
        {loading && results === null && <p className="mt-3 text-sm text-neuron-muted">Searching…</p>}
        {results !== null && results.length === 0 && <p className="mt-3 text-sm text-neuron-muted">Nothing found for “{query.trim()}”.</p>}
      </div>
      {results && results.length > 0 && (
        <ul className="mt-3 space-y-2">
          {results.map((r) => (
            <li key={`${r.contentType}-${r.sourceId}`}>
              <Link href={r.url} className="card block !p-4 transition hover:border-neuron-accent">
                <span className="eyebrow">{SEARCH_CONTENT_TYPE_ICONS[r.contentType]} {SEARCH_CONTENT_TYPE_LABELS[r.contentType]} · {r.interestLabel}</span>
                <span className="mt-1 block font-bold leading-snug">{r.title}</span>
                {/* The snippet comes from our own index with <mark> around matches; text is escaped below. */}
                <span className="mt-1 block text-sm text-neuron-muted" dangerouslySetInnerHTML={{ __html: escapeExceptMark(r.snippet) }} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Escapes HTML in a snippet, keeping only the <mark> tags the search index adds. */
function escapeExceptMark(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&lt;mark&gt;/g, "<mark>")
    .replace(/&lt;\/mark&gt;/g, "</mark>");
}

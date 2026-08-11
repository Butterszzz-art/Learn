"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SearchContentType } from "@/lib/searchTypes";
import { SEARCH_CONTENT_TYPE_ICONS, SEARCH_CONTENT_TYPE_LABELS } from "@/lib/searchTypes";

interface SearchResult {
  contentType: SearchContentType;
  sourceId: number;
  title: string;
  snippet: string;
  interestLabel: string;
  date: string;
  url: string;
}

/**
 * The persistent search entry point (Phase 11) — a small button in the nav
 * bar, reachable from any page, plus a global Cmd/Ctrl+K shortcut that opens
 * the same overlay from anywhere. Results are grouped by content type (the
 * cleaner read here, given results routinely span News/Deep Dives/Drills/
 * etc. across many different interests) in the order each type's first,
 * most-relevant hit appeared in the underlying ranked query — so the most
 * relevant content type naturally leads.
 */
export function SearchOverlay() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isK = e.key === "k" || e.key === "K";
      if ((e.metaKey || e.ctrlKey) && isK) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      // Wait a tick for the input to mount before focusing it.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
        const data = await res.json().catch(() => null);
        setResults(data?.results ?? []);
      } catch (err) {
        console.error(err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Group in first-appearance order, preserving each group's internal
  // relevance order — the query itself is already sorted by rank, date DESC.
  const groups: { contentType: SearchContentType; items: SearchResult[] }[] = [];
  for (const r of results) {
    let group = groups.find((g) => g.contentType === r.contentType);
    if (!group) {
      group = { contentType: r.contentType, items: [] };
      groups.push(group);
    }
    group.items.push(r);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="nav-link flex items-center gap-1.5"
        title="Search (Ctrl/Cmd+K)"
      >
        <span aria-hidden>🔍</span>
        <span className="hidden sm:inline">Search</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[10vh] backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-3xl border border-neuron-border bg-neuron-surface p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-neuron-border pb-3">
              <span className="text-lg">🔍</span>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search everything you've generated or read…"
                className="flex-1 bg-transparent text-sm text-neuron-text placeholder:text-neuron-muted focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs text-neuron-muted hover:text-neuron-text"
              >
                Esc
              </button>
            </div>

            <div className="mt-3 max-h-[60vh] overflow-y-auto">
              {loading && <p className="px-1 py-3 text-xs text-neuron-muted">Searching…</p>}
              {!loading && query.trim() && results.length === 0 && (
                <p className="px-1 py-3 text-xs text-neuron-muted">No matches for "{query.trim()}".</p>
              )}
              {!loading && !query.trim() && (
                <p className="px-1 py-3 text-xs text-neuron-muted">
                  Search across every News item, Deep Dive, Applied Insight, Drill, Explain It Back,
                  Mental Model, Rabbit Hole, and Library chapter you've ever generated.
                </p>
              )}
              {groups.map((group) => (
                <div key={group.contentType} className="mb-3">
                  <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-neuron-muted">
                    {SEARCH_CONTENT_TYPE_ICONS[group.contentType]} {SEARCH_CONTENT_TYPE_LABELS[group.contentType]}
                  </p>
                  <div className="space-y-1">
                    {group.items.map((r) => (
                      <Link
                        key={`${r.contentType}-${r.sourceId}`}
                        href={r.url}
                        onClick={() => setOpen(false)}
                        className="block rounded-2xl px-2 py-2 transition hover:bg-neuron-surface2"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium leading-snug">{r.title}</span>
                          <span className="shrink-0 text-[11px] text-neuron-muted">{r.interestLabel}</span>
                        </div>
                        <p
                          className="mt-0.5 line-clamp-1 text-xs text-neuron-muted"
                          dangerouslySetInnerHTML={{ __html: r.snippet }}
                        />
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

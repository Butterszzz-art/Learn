"use client";

import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { postJson } from "@/lib/ui";
import { DEFAULT_SUMMARY_LENGTH, SUMMARY_LENGTH_LABELS, readMinutes, wordCount } from "@/lib/summaryLength";
import type { SummaryLength } from "@/lib/summaryLength";

interface Ctx {
  /** The reader's default length, from Settings. */
  preferred: SummaryLength;
  /** Saves a new default (from a card's "Use for every card" link). */
  setPreferred: (l: SummaryLength) => void;
}

// Outside the feed (single-card and review pages) there is no provider:
// cards open at the default length, and choosing a new default still saves.
const SummaryLengthContext = createContext<Ctx>({
  preferred: DEFAULT_SUMMARY_LENGTH,
  setPreferred: (l) => void postJson("/api/settings", { summaryLength: l }).catch(() => {}),
});

export function SummaryLengthProvider({ initial, children }: { initial?: SummaryLength; children: ReactNode }) {
  const [preferred, setState] = useState<SummaryLength>(initial ?? DEFAULT_SUMMARY_LENGTH);
  const setPreferred = (l: SummaryLength) => {
    setState(l);
    postJson("/api/settings", { summaryLength: l }).catch(() => {});
  };
  return <SummaryLengthContext.Provider value={{ preferred, setPreferred }}>{children}</SummaryLengthContext.Provider>;
}

export function useSummaryLength() {
  return useContext(SummaryLengthContext);
}

/**
 * The length a card opens at: the reader's default when the card offers it,
 * otherwise the longest length the card has.
 */
export function useCardLength(options: SummaryLength[]) {
  const { preferred, setPreferred } = useSummaryLength();
  const start = options.includes(preferred) ? preferred : options[options.length - 1];
  const [length, setLength] = useState<SummaryLength>(start);
  return { length, setLength, preferred, setPreferred };
}

/**
 * Segmented control under a card's text for previewing the other lengths,
 * with the word count and reading time of what is showing.
 */
export function LengthSwitcher({
  options,
  value,
  onChange,
  shownText,
  loading = false,
  labels,
}: {
  options: SummaryLength[];
  value: SummaryLength;
  onChange: (l: SummaryLength) => void;
  shownText: string;
  loading?: boolean;
  labels?: Partial<Record<SummaryLength, string>>;
}) {
  const { preferred, setPreferred } = useSummaryLength();
  if (options.length < 2) return null;
  const words = wordCount(shownText);
  return (
    <div className="mt-5">
      <div role="radiogroup" aria-label="Summary length" className="inline-flex rounded-full border border-neuron-border bg-neuron-surface2 p-1">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={value === o}
            onClick={() => onChange(o)}
            className={`min-h-[36px] rounded-full px-3 text-xs font-extrabold transition ${
              value === o ? "bg-neuron-surface text-neuron-text shadow-sm" : "text-neuron-muted hover:text-neuron-text"
            }`}
          >
            {labels?.[o] ?? SUMMARY_LENGTH_LABELS[o]}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-neuron-muted" aria-live="polite">
        {loading ? "Writing the in-depth version…" : `${words} words · ${readMinutes(shownText)} min read`}
        {!loading && value !== preferred && (
          <>
            {" · "}
            <button type="button" className="font-bold text-neuron-accent" onClick={() => setPreferred(value)}>
              Use {(labels?.[value] ?? SUMMARY_LENGTH_LABELS[value]).toLowerCase()} for every card
            </button>
          </>
        )}
      </p>
    </div>
  );
}

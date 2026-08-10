"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { StreamCard } from "@/lib/stream";
import { streamCardIcon, streamCardPreview } from "@/lib/stream";
import { StreamCardView } from "./StreamCardView";
import { PassionModeControls } from "../PassionModeControls";

export interface StreamInterestPill {
  id: number;
  name: string;
  isFavorite: boolean;
}

/**
 * Phase 8 — the single-focus, swipeable Focus mode plus a toggleable
 * Overview mode, both reading from the same `cards` array (already ordered
 * server-side — see buildReadingStream in lib/stream.ts). No auto-advance or
 * timer of any kind: the only ways to move are swipe/scroll (native CSS
 * scroll-snap), the prev/next buttons, arrow keys, or j/k.
 */
export function StreamContainer({
  cards,
  interestPills,
  periodLabel,
  frequency,
  totalEntries,
  createdLabel,
  initialCardId,
}: {
  cards: StreamCard[];
  interestPills: StreamInterestPill[];
  periodLabel: string;
  frequency: string;
  totalEntries: number;
  createdLabel: string;
  initialCardId?: string;
}) {
  const [mode, setMode] = useState<"focus" | "overview">("focus");
  const [selectedInterest, setSelectedInterest] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRaf = useRef<number | null>(null);

  const filteredCards = useMemo(
    () => (selectedInterest ? cards.filter((c) => !c.interestName || c.interestName === selectedInterest) : cards),
    [cards, selectedInterest]
  );

  const initialIndex = useMemo(() => {
    if (!initialCardId) return 0;
    const i = cards.findIndex((c) => c.id === initialCardId);
    return i >= 0 ? i : 0;
  }, [initialCardId, cards]);

  const [index, setIndex] = useState(initialIndex);

  function scrollToIndex(i: number, behavior: ScrollBehavior = "smooth") {
    const el = containerRef.current;
    if (!el) return;
    // Every card is exactly one container-height tall (h-full), so its
    // target scrollTop is just i * clientHeight — no DOM measurement
    // needed. (child.offsetTop would be wrong here: it's relative to the
    // nearest *positioned* ancestor, not necessarily this container, and
    // child.scrollIntoView() would scroll ancestor scrollables too — i.e.
    // the whole page — yanking the header/pills out of view.)
    el.scrollTo({ top: i * el.clientHeight, behavior });
  }

  useEffect(() => {
    // On mount, jump straight to the returning-from-deep-dive position (if
    // any) with no animation.
    scrollToIndex(initialIndex, "auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goTo(i: number) {
    const clamped = Math.max(0, Math.min(filteredCards.length - 1, i));
    setIndex(clamped);
    scrollToIndex(clamped);
  }

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => {
      const i = Math.round(el.scrollTop / Math.max(1, el.clientHeight));
      setIndex((prev) => {
        const clamped = Math.max(0, Math.min(filteredCards.length - 1, i));
        return prev === clamped ? prev : clamped;
      });
    });
  }

  useEffect(() => {
    if (mode !== "focus") return;
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "j" || e.key === "J") {
        e.preventDefault();
        goTo(index + 1);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "k" || e.key === "K") {
        e.preventDefault();
        goTo(index - 1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, index, filteredCards.length]);

  function jumpToCard(cardId: string) {
    const i = filteredCards.findIndex((c) => c.id === cardId);
    setMode("focus");
    if (i >= 0) {
      setIndex(i);
      requestAnimationFrame(() => scrollToIndex(i, "auto"));
    }
  }

  function selectInterest(name: string | null) {
    setSelectedInterest(name);
    setIndex(0);
    requestAnimationFrame(() => scrollToIndex(0, "auto"));
  }

  const activeFavoritePill = selectedInterest
    ? interestPills.find((p) => p.name === selectedInterest && p.isFavorite)
    : null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">{periodLabel}</h1>
          <p className="text-xs text-neuron-muted">
            {frequency} cycle · {totalEntries} items · last updated {createdLabel}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setMode("focus")} className={mode === "focus" ? "nav-link-active" : "nav-link"}>
            Focus
          </button>
          <button
            type="button"
            onClick={() => setMode("overview")}
            className={mode === "overview" ? "nav-link-active" : "nav-link"}
          >
            Overview
          </button>
        </div>
      </div>

      {interestPills.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => selectInterest(null)} className={!selectedInterest ? "nav-link-active" : "nav-link"}>
            All
          </button>
          {interestPills.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => selectInterest(p.name)}
              className={selectedInterest === p.name ? "nav-link-active" : "nav-link"}
            >
              {p.isFavorite ? "★ " : ""}
              {p.name}
            </button>
          ))}
        </div>
      )}

      {activeFavoritePill && (
        <div className="mb-4">
          <PassionModeControls interestId={activeFavoritePill.id} />
        </div>
      )}

      {filteredCards.length === 0 ? (
        <div className="card text-center">
          <p className="mb-1 text-lg font-medium">Nothing here yet</p>
          <p className="text-sm text-neuron-muted">
            Click "Refresh now" to fetch news and generate deep dives for this cycle.
          </p>
        </div>
      ) : mode === "focus" ? (
        <>
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="snap-y snap-mandatory scroll-smooth h-[calc(100vh-16rem)] min-h-[420px] overflow-y-auto rounded-3xl border border-neuron-border/60 bg-neuron-bg/30"
          >
            {filteredCards.map((card) => {
              const fullIndex = cards.findIndex((c) => c.id === card.id);
              const nextCardId = cards[fullIndex + 1]?.id;
              return (
                <div key={card.id} className="flex h-full snap-start flex-col justify-center overflow-y-auto p-4 sm:p-8">
                  <div className="mx-auto w-full max-w-xl">
                    <StreamCardView card={card} nextCardId={nextCardId} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-neuron-muted">
            <button type="button" className="btn-secondary text-xs" onClick={() => goTo(index - 1)} disabled={index === 0}>
              ← Prev
            </button>
            <span>
              {index + 1} / {filteredCards.length} · swipe, scroll, or use ↑↓ / j·k
            </span>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => goTo(index + 1)}
              disabled={index === filteredCards.length - 1}
            >
              Next →
            </button>
          </div>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filteredCards.map((card) => {
            const preview = streamCardPreview(card);
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => jumpToCard(card.id)}
                className="card block text-left transition hover:-translate-y-0.5 hover:border-neuron-accent hover:shadow-xl hover:shadow-neuron-accent/10"
              >
                <div className="mb-1 flex items-center gap-2 text-xs text-neuron-muted">
                  <span>{streamCardIcon(card)}</span>
                  {card.interestName && <span className="pill">{card.interestName}</span>}
                </div>
                <p className="mb-1 text-sm font-semibold leading-snug">{preview.title}</p>
                <p className="line-clamp-2 text-xs text-neuron-muted">{preview.snippet}</p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

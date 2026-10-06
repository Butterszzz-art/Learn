"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { StreamCard } from "@/lib/stream";
import { streamCardIcon, streamCardPreview } from "@/lib/stream";
import { StreamCardView } from "./StreamCardView";
import { PassionModeControls } from "../PassionModeControls";

export interface StreamInterestPill {
  id: number;
  name: string;
  isFavorite: boolean;
}

// Phase 16 — condensed nav links shown inside the mobile Focus-mode chrome
// bar. The real site Nav (layout.tsx) sits behind the full-screen mobile
// card overlay, so Focus mode needs its own compact way back to it.
const MINI_NAV: { href: string; label: string; icon: string }[] = [
  { href: "/", label: "Home", icon: "🧠" },
  { href: "/drills", label: "Drills", icon: "🎯" },
  { href: "/library", label: "Library", icon: "📚" },
  { href: "/archive", label: "Archive", icon: "🗂️" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

/**
 * Phase 8 — the single-focus, swipeable Focus mode plus a toggleable
 * Overview mode, both reading from the same `cards` array (already ordered
 * server-side — see buildReadingStream in lib/stream.ts). No auto-advance or
 * timer of any kind: the only ways to move are swipe/scroll (native CSS
 * scroll-snap), the prev/next buttons, arrow keys, or j/k.
 *
 * Phase 13: `hiddenCardIds` (weekly-cadence cards from a bundle already
 * fully shown to the reader — see digest.ts's getHybridCurrentFeed) are
 * excluded from Focus mode's DEFAULT deck only. Overview mode's grid always
 * shows every card in `cards`, unfiltered — "browsable all week" for the
 * weekly bundle. Any explicit browse action (jumping to a card from
 * Overview, selecting an interest pill, or landing here via a deep link)
 * reveals everything for the rest of the session (`hasBrowsedFull`).
 *
 * Phase 16 — mobile fix: on narrow viewports, Focus mode's card container
 * becomes a genuinely full-screen (100dvh) fixed overlay instead of a boxed
 * region squeezed between permanently-visible chrome. The header/toggle/
 * pills row collapses into a single auto-hiding bar that floats on top of
 * the card (hides on swipe, reappears on tap or scroll-up), and the bottom
 * Prev/Next row shrinks to a small position pill. All of this is gated by
 * `mode === "focus"` and the `sm:` breakpoint — desktop layout and Overview
 * mode (on any viewport) are unchanged.
 */
export function StreamContainer({
  cards,
  interestPills,
  periodLabel,
  frequency,
  totalEntries,
  createdLabel,
  initialCardId,
  hiddenCardIds,
}: {
  cards: StreamCard[];
  interestPills: StreamInterestPill[];
  periodLabel: string;
  frequency: string;
  totalEntries: number;
  createdLabel: string;
  initialCardId?: string;
  hiddenCardIds?: string[];
}) {
  const [mode, setMode] = useState<"focus" | "overview">("focus");
  const [selectedInterest, setSelectedInterest] = useState<string | null>(null);
  const [hasBrowsedFull, setHasBrowsedFull] = useState(!!initialCardId);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRaf = useRef<number | null>(null);
  const lastScrollTopRef = useRef(0);

  // Only ever true while actually in Focus mode — the header/toggle/pills
  // block above is shared by both modes, so this flag is what switches it
  // between "auto-hiding mobile overlay bar" and its normal static self.
  // (The card container and bottom bar below live entirely inside the
  // focus-mode branch, so they don't need this flag — they can just use
  // `sm:` classes directly.)
  const isMobileFocusChrome = mode === "focus";

  const hiddenSet = useMemo(() => new Set(hiddenCardIds ?? []), [hiddenCardIds]);

  // Focus mode's default deck: everything, minus already-fully-seen weekly
  // cards — unless the reader has explicitly browsed past that (Overview
  // jump, pill selection, or arriving via a deep link).
  const focusDeck = useMemo(
    () => (hasBrowsedFull ? cards : cards.filter((c) => !hiddenSet.has(c.id))),
    [cards, hiddenSet, hasBrowsedFull]
  );

  const filteredCards = useMemo(
    () => (selectedInterest ? focusDeck.filter((c) => !c.interestName || c.interestName === selectedInterest) : focusDeck),
    [focusDeck, selectedInterest]
  );

  const initialIndex = useMemo(() => {
    if (!initialCardId) return 0;
    const i = filteredCards.findIndex((c) => c.id === initialCardId);
    return i >= 0 ? i : 0;
  }, [initialCardId, filteredCards]);

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

  // Phase 16 — while Focus mode is on screen on a narrow viewport, bump the
  // root font-size (and, since Tailwind's spacing scale is rem-based too,
  // card padding right along with it — see the `.neuron-mobile-focus` rule
  // in globals.css) and lock background scroll. Both are no-ops above the
  // `sm` breakpoint (media-query gated in CSS) and are removed the instant
  // the reader leaves Focus mode or this component unmounts.
  useEffect(() => {
    const root = document.documentElement;
    if (mode === "focus") {
      root.classList.add("neuron-mobile-focus");
      setChromeVisible(true);
      setFiltersOpen(false);
    } else {
      root.classList.remove("neuron-mobile-focus");
    }
    return () => root.classList.remove("neuron-mobile-focus");
  }, [mode]);

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
      // Auto-hide the mobile chrome bar once the reader swipes forward past
      // the very top of the deck; scrolling/swiping back up (or the pull
      // handle / a tap) brings it back. Has no visible effect on desktop —
      // the bar there ignores `chromeVisible` and stays static (see the
      // `sm:translate-y-0` override on its className).
      const delta = el.scrollTop - lastScrollTopRef.current;
      if (Math.abs(delta) > 8) {
        if (delta > 0 && el.scrollTop > 24) setChromeVisible(false);
        else if (delta < 0) setChromeVisible(true);
      }
      lastScrollTopRef.current = el.scrollTop;
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

  // Overview mode's grid (and jumpToCard's target list below) always reads
  // from the full `cards` array, never the hidden-trimmed focusDeck — that's
  // what makes the weekly bundle "browsable all week" per Phase 13.
  const overviewCards = useMemo(
    () => (selectedInterest ? cards.filter((c) => !c.interestName || c.interestName === selectedInterest) : cards),
    [cards, selectedInterest]
  );

  function jumpToCard(cardId: string) {
    // Reveal everything from here on — an explicit jump from Overview
    // shouldn't land on a card Focus mode's default deck would then hide.
    setHasBrowsedFull(true);
    const i = overviewCards.findIndex((c) => c.id === cardId);
    setMode("focus");
    if (i >= 0) {
      setIndex(i);
      requestAnimationFrame(() => scrollToIndex(i, "auto"));
    }
  }

  function selectInterest(name: string | null) {
    // Same reasoning as jumpToCard: picking a specific interest is a
    // "browse everything about this" action, so reveal its full weekly
    // bundle too, not just the still-unseen slice.
    setHasBrowsedFull(true);
    setSelectedInterest(name);
    setIndex(0);
    setFiltersOpen(false);
    requestAnimationFrame(() => scrollToIndex(0, "auto"));
  }

  const activeFavoritePill = selectedInterest
    ? interestPills.find((p) => p.name === selectedInterest && p.isFavorite)
    : null;

  const pillButtons = (
    <>
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
    </>
  );

  return (
    <div>
      {/* Mobile Focus-mode pull handle — an independent fixed element (not
          nested in the bar below) so it stays put and tappable even while
          the bar above it is translated fully offscreen. */}
      {isMobileFocusChrome && (
        <button
          type="button"
          onClick={() => setChromeVisible(true)}
          aria-label="Show menu"
          className={`fixed inset-x-0 top-0 z-30 flex justify-center pt-1.5 transition-opacity duration-200 sm:hidden ${
            chromeVisible ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          <span className="h-1.5 w-12 rounded-full bg-neuron-border shadow-lg shadow-black/30" />
        </button>
      )}

      <div
        className={
          isMobileFocusChrome
            ? `fixed inset-x-0 top-0 z-40 border-b border-neuron-border/60 bg-neuron-bg/95 backdrop-blur-md transition-transform duration-300 ease-out sm:static sm:z-auto sm:translate-y-0 sm:border-0 sm:bg-transparent sm:backdrop-blur-none sm:transition-none ${
                chromeVisible ? "translate-y-0" : "-translate-y-full"
              }`
            : ""
        }
      >
        <div
          className={
            isMobileFocusChrome
              ? "flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:mb-4 sm:items-start sm:gap-3 sm:px-0 sm:py-0"
              : "mb-4 flex flex-wrap items-start justify-between gap-3"
          }
        >
          <div className="min-w-0">
            <h1 className={isMobileFocusChrome ? "truncate font-display text-sm font-bold sm:text-2xl" : "font-display text-2xl font-bold"}>
              {periodLabel}
            </h1>
            <p className={isMobileFocusChrome ? "hidden text-xs text-neuron-muted sm:block" : "text-xs text-neuron-muted"}>
              {/* Phase 13: the live home feed passes frequency="hybrid" — its
                  two-cadence label is already spelled out in periodLabel above,
                  so this line skips the redundant "hybrid cycle" prefix.
                  Archive keeps the real daily/weekly value here. */}
              {frequency !== "hybrid" && `${frequency} cycle · `}
              {totalEntries} items · last updated {createdLabel}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {isMobileFocusChrome && (
              <nav className="mr-1 flex items-center gap-0.5 sm:hidden" aria-label="Quick navigation">
                {MINI_NAV.map((l) => (
                  <Link key={l.href} href={l.href} aria-label={l.label} className="nav-link !px-1.5 !py-1 text-sm">
                    {l.icon}
                  </Link>
                ))}
              </nav>
            )}
            <button
              type="button"
              onClick={() => setMode("focus")}
              className={`${mode === "focus" ? "nav-link-active" : "nav-link"}${
                isMobileFocusChrome ? " !px-2.5 !py-1 text-xs sm:!px-3 sm:!py-1.5 sm:text-sm" : ""
              }`}
            >
              Focus
            </button>
            <button
              type="button"
              onClick={() => setMode("overview")}
              className={`${mode === "overview" ? "nav-link-active" : "nav-link"}${
                isMobileFocusChrome ? " !px-2.5 !py-1 text-xs sm:!px-3 sm:!py-1.5 sm:text-sm" : ""
              }`}
            >
              Overview
            </button>
          </div>
        </div>

        {interestPills.length > 1 &&
          (isMobileFocusChrome ? (
            <>
              {/* Mobile: pills collapse into a single filter icon that
                  expands the pill list on tap, instead of an always-visible
                  row eating vertical space. */}
              <div className="flex items-center gap-2 px-4 pb-2 sm:hidden">
                <button
                  type="button"
                  onClick={() => setFiltersOpen((v) => !v)}
                  aria-expanded={filtersOpen}
                  aria-label="Filter by interest"
                  className="nav-link !px-2.5 !py-1 text-xs"
                >
                  🔎 {selectedInterest ?? "All interests"}
                </button>
              </div>
              {filtersOpen && (
                <div className="flex flex-wrap gap-2 border-t border-neuron-border/40 px-4 pb-3 pt-2 sm:hidden">{pillButtons}</div>
              )}
              {/* Desktop keeps the always-visible pill row, unchanged. */}
              <div className="hidden flex-wrap gap-2 sm:mb-4 sm:flex">{pillButtons}</div>
            </>
          ) : (
            <div className="mb-4 flex flex-wrap gap-2">{pillButtons}</div>
          ))}
      </div>

      {activeFavoritePill && (
        <div className={isMobileFocusChrome ? "mb-4 hidden sm:block" : "mb-4"}>
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
            className="fixed inset-0 z-20 h-[100dvh] w-full snap-y snap-mandatory overflow-y-auto scroll-smooth bg-neuron-bg sm:static sm:z-auto sm:h-[calc(100vh-16rem)] sm:min-h-[420px] sm:w-auto sm:rounded-3xl sm:border sm:border-neuron-border/60 sm:bg-neuron-bg/30"
          >
            {filteredCards.map((card) => {
              const fullIndex = cards.findIndex((c) => c.id === card.id);
              const nextCardId = cards[fullIndex + 1]?.id;
              return (
                <div
                  key={card.id}
                  className="flex h-full snap-start flex-col overflow-y-auto px-5 pb-24 pt-16 sm:p-8"
                >
                  <div className="mx-auto my-auto w-full max-w-xl">
                    <StreamCardView card={card} nextCardId={nextCardId} />
                  </div>
                </div>
              );
            })}
          </div>
          {/* Mobile: swipe/scroll is already the primary navigation (per
              Phase 8) so the bottom bar shrinks to a small, unobtrusive
              position pill. Desktop keeps the full Prev/Next buttons. */}
          <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-center pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 text-xs text-neuron-muted sm:static sm:z-auto sm:mt-3 sm:justify-between sm:px-0 sm:pb-0 sm:pt-0">
            <button
              type="button"
              className="btn-secondary hidden text-xs sm:inline-flex"
              onClick={() => goTo(index - 1)}
              disabled={index === 0}
            >
              ← Prev
            </button>
            <span className="pointer-events-none rounded-full border border-neuron-border/60 bg-neuron-bg/85 px-3 py-1 text-[11px] font-semibold backdrop-blur-md sm:pointer-events-auto sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:text-xs sm:font-normal">
              <span className="sm:hidden">
                {index + 1}/{filteredCards.length}
              </span>
              <span className="hidden sm:inline">
                {index + 1} / {filteredCards.length} · swipe, scroll, or use ↑↓ / j·k
              </span>
            </span>
            <button
              type="button"
              className="btn-secondary hidden text-xs sm:inline-flex"
              onClick={() => goTo(index + 1)}
              disabled={index === filteredCards.length - 1}
            >
              Next →
            </button>
          </div>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {overviewCards.map((card) => {
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

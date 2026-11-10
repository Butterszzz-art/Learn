"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeedCard, CardEvent, CardEventName } from "@/lib/cardTypes";
import { CardView } from "./CardView";
import type { CardHandlers } from "./CardView";
import { AskSheet, DeepDiveSheet, ReportSheet } from "./Sheets";

const PAGE_SIZE = 10;
const PREFETCH_WHEN_LEFT = 4; // ask for the next page this many cards before the end
const RENDER_WINDOW = 2; // cards kept mounted either side of the current one
const RECAP_EVERY = 15;
const FLUSH_MS = 4000;
const POSITION_KEY = "neuron.feed.v1";

export interface FeedInterest {
  id: number;
  name: string;
}

interface SavedSession {
  cards: FeedCard[];
  index: number;
  at: number;
}

/**
 * The swipe feed. One card fills the screen; vertical scroll-snap moves
 * between them (touch, wheel, arrow keys, j/k). Cards load ten at a time
 * and the next page is fetched before the reader reaches the end, so there
 * is no loading state mid-swipe. Only the cards near the current one are
 * mounted.
 */
export function FeedClient({ initialCards, initialHasMore, interests }: { initialCards: FeedCard[]; initialHasMore: boolean; interests: FeedInterest[] }) {
  const [cards, setCards] = useState<FeedCard[]>(initialCards);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [index, setIndex] = useState(0);
  const [filter, setFilter] = useState<number | null>(null);
  const [sheet, setSheet] = useState<{ type: "dive"; id: number } | { type: "ask"; card: FeedCard } | { type: "report"; card: FeedCard } | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const loading = useRef(false);
  const queue = useRef<CardEvent[]>([]);
  const shownAt = useRef<number>(Date.now());
  const impressed = useRef<Set<number>>(new Set());
  const sinceRecap = useRef<{ count: number; concepts: string[] }>({ count: 0, concepts: [] });
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const indexRef = useRef(index);
  indexRef.current = index;

  // --- event reporting ----------------------------------------------------
  const flush = useCallback((useBeacon = false) => {
    if (queue.current.length === 0) return;
    const events = queue.current;
    queue.current = [];
    const body = JSON.stringify({ events });
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
      return;
    }
    fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {
      // Offline: keep them for the next flush (bounded so it can't grow forever).
      queue.current = [...events, ...queue.current].slice(-200);
    });
  }, []);

  const onEvent = useCallback(
    (cardId: number, event: CardEventName, value?: number) => {
      queue.current.push({ cardId, event, value });
      // Things the reader did on purpose are sent straight away.
      if (event !== "impression" && event !== "dwell") flush();
    },
    [flush]
  );

  const closeOut = useCallback(
    (i: number) => {
      const card = cardsRef.current[i];
      if (card?.cardId) onEvent(card.cardId, "dwell", Date.now() - shownAt.current);
    },
    [onEvent]
  );

  useEffect(() => {
    const t = setInterval(() => flush(), FLUSH_MS);
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        closeOut(indexRef.current);
        flush(true);
        try {
          const session: SavedSession = { cards: cardsRef.current.slice(0, 60), index: indexRef.current, at: Date.now() };
          sessionStorage.setItem(POSITION_KEY, JSON.stringify(session));
        } catch {}
      } else {
        shownAt.current = Date.now();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      closeOut(indexRef.current);
      flush(true);
    };
  }, [flush, closeOut]);

  // Coming back from a deep dive within a few minutes: restore the place.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(POSITION_KEY);
      if (!raw) return;
      sessionStorage.removeItem(POSITION_KEY);
      const saved = JSON.parse(raw) as SavedSession;
      if (Date.now() - saved.at > 20 * 60000 || !saved.cards?.length) return;
      setCards(saved.cards);
      setIndex(saved.index);
      requestAnimationFrame(() => {
        const el = scroller.current;
        if (el) el.scrollTo({ top: saved.index * el.clientHeight });
      });
    } catch {}
  }, []);

  // --- paging -------------------------------------------------------------
  const loadMore = useCallback(
    async (replace = false, interestId: number | null = filter) => {
      if (loading.current) return;
      loading.current = true;
      try {
        const current = replace ? [] : cardsRef.current;
        const res = await fetch("/api/feed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            exclude: current.map((c) => c.cardId).filter((x): x is number => x !== null),
            excludeKeys: current.filter((c) => c.cardId === null || c.kind === "review").map((c) => c.key),
            count: PAGE_SIZE,
            interestId: interestId ?? undefined,
          }),
        });
        if (!res.ok) return;
        const page = (await res.json()) as { cards: FeedCard[]; hasMore: boolean };
        setHasMore(page.hasMore);
        setCards((prev) => {
          const base = replace ? [] : prev.filter((c) => c.kind !== "brewing" || page.cards.length === 0 || page.cards.every((n) => n.kind === "brewing"));
          const seen = new Set(base.map((c) => c.key));
          return [...base, ...page.cards.filter((c) => !seen.has(c.key))];
        });
      } catch {
        // Offline: the cards already loaded stay usable.
      } finally {
        loading.current = false;
      }
    },
    [filter]
  );

  // --- current-card bookkeeping -------------------------------------------
  useEffect(() => {
    const card = cards[index];
    if (!card) return;
    shownAt.current = Date.now();
    if (card.cardId && !impressed.current.has(card.cardId)) {
      impressed.current.add(card.cardId);
      onEvent(card.cardId, "impression");
      // Session recap: every RECAP_EVERY real cards, slot a recap in next.
      const s = sinceRecap.current;
      s.count++;
      if (card.conceptName && !s.concepts.includes(card.conceptName)) s.concepts.push(card.conceptName);
      if (s.count >= RECAP_EVERY) {
        const recap: FeedCard = {
          key: `recap-${Date.now()}`,
          kind: "recap",
          cardId: null,
          interestId: null,
          interestName: null,
          level: null,
          title: s.concepts.length > 0 ? `You just covered ${s.concepts.length} idea${s.concepts.length === 1 ? "" : "s"}` : `${s.count} cards in`,
          body: `${s.count} cards this stretch.`,
          payload: { concepts: s.concepts.slice(0, 8) },
          conceptId: null,
          conceptName: null,
          deepDiveId: null,
          deepDiveTopic: null,
          explore: false,
          saved: false,
          aiGenerated: false,
        };
        sinceRecap.current = { count: 0, concepts: [] };
        setCards((prev) => [...prev.slice(0, index + 1), recap, ...prev.slice(index + 1)]);
      }
    }
    if (hasMore && cards.length - index <= PREFETCH_WHEN_LEFT) loadMore();
  }, [index, cards, hasMore, loadMore, onEvent]);

  const goTo = useCallback((i: number) => {
    const el = scroller.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(cardsRef.current.length - 1, i));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: clamped * el.clientHeight, behavior: reduce ? "auto" : "smooth" });
  }, []);

  const raf = useRef<number | null>(null);
  function onScroll() {
    if (raf.current !== null) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      const el = scroller.current;
      if (!el || el.clientHeight === 0) return;
      const i = Math.round(el.scrollTop / el.clientHeight);
      if (i !== indexRef.current) {
        closeOut(indexRef.current);
        setIndex(i);
      }
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (sheet) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowDown" || e.key === "j" || e.key === "PageDown") {
        e.preventDefault();
        goTo(indexRef.current + 1);
      } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "PageUp") {
        e.preventDefault();
        goTo(indexRef.current - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, sheet]);

  function changeFilter(id: number | null) {
    closeOut(indexRef.current);
    setFilter(id);
    setIndex(0);
    scroller.current?.scrollTo({ top: 0 });
    loadMore(true, id);
  }

  const handlers: CardHandlers = useMemo(
    () => ({
      onEvent,
      onOpenDeepDive: (id) => setSheet({ type: "dive", id }),
      onAsk: (card) => setSheet({ type: "ask", card }),
      onReport: (card) => setSheet({ type: "report", card }),
      onRefresh: () => loadMore(),
    }),
    [onEvent, loadMore]
  );

  return (
    <div className="relative flex h-full flex-col">
      {interests.length > 1 && (
        <div className="flex shrink-0 gap-2 overflow-x-auto px-4 pb-1 pt-3 sm:px-6 [scrollbar-width:none]" role="toolbar" aria-label="Filter the feed by interest">
          <button type="button" onClick={() => changeFilter(null)} aria-pressed={filter === null} className={`pill shrink-0 !py-1.5 ${filter === null ? "!border-neuron-accent !bg-neuron-accent/15 !text-neuron-text" : ""}`}>
            For you
          </button>
          {interests.map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => changeFilter(i.id)}
              aria-pressed={filter === i.id}
              className={`pill shrink-0 !py-1.5 ${filter === i.id ? "!border-neuron-accent !bg-neuron-accent/15 !text-neuron-text" : ""}`}
            >
              {i.name}
            </button>
          ))}
        </div>
      )}

      <div ref={scroller} onScroll={onScroll} className="feed-scroller min-h-0 flex-1" aria-label="Your feed" role="feed" aria-busy={loading.current}>
        {cards.map((card, i) => (
          <div key={card.key} className="feed-slot" aria-setsize={hasMore ? -1 : cards.length} aria-posinset={i + 1}>
            {Math.abs(i - index) <= RENDER_WINDOW ? <CardView card={card} active={i === index} handlers={handlers} /> : null}
          </div>
        ))}
      </div>

      <div className="pointer-events-none absolute bottom-24 right-3 hidden flex-col gap-2 md:flex">
        <button type="button" aria-label="Previous card" onClick={() => goTo(index - 1)} disabled={index === 0} className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-neuron-border bg-neuron-surface text-lg shadow disabled:opacity-40">
          ↑
        </button>
        <button type="button" aria-label="Next card" onClick={() => goTo(index + 1)} disabled={index >= cards.length - 1} className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-neuron-border bg-neuron-surface text-lg shadow disabled:opacity-40">
          ↓
        </button>
      </div>

      {sheet?.type === "dive" && <DeepDiveSheet deepDiveId={sheet.id} onClose={() => setSheet(null)} />}
      {sheet?.type === "ask" && <AskSheet card={sheet.card} onClose={() => setSheet(null)} />}
      {sheet?.type === "report" && <ReportSheet card={sheet.card} onClose={() => setSheet(null)} />}
    </div>
  );
}

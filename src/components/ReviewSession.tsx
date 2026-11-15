"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import type { FeedCard, CardEventName } from "@/lib/cardTypes";
import { CardView } from "./feed/CardView";
import type { CardHandlers } from "./feed/CardView";
import { AskSheet, DeepDiveSheet, ReportSheet } from "./feed/Sheets";

/** One-at-a-time run through due reviews (or extra practice questions). */
export function ReviewSession({ cards, emptyTitle, emptyText }: { cards: FeedCard[]; emptyTitle: string; emptyText: string }) {
  const [i, setI] = useState(0);
  const [sheet, setSheet] = useState<{ type: "dive"; id: number } | { type: "ask"; card: FeedCard } | { type: "report"; card: FeedCard } | null>(null);

  const onEvent = useCallback((cardId: number, event: CardEventName, value?: number) => {
    fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events: [{ cardId, event, value }] }), keepalive: true }).catch(() => {});
  }, []);
  const handlers: CardHandlers = useMemo(
    () => ({
      onEvent,
      onOpenDeepDive: (id) => setSheet({ type: "dive", id }),
      onAsk: (card) => setSheet({ type: "ask", card }),
      onReport: (card) => setSheet({ type: "report", card }),
      onRefresh: () => {},
    }),
    [onEvent]
  );

  if (cards.length === 0 || i >= cards.length) {
    return (
      <div className="card text-center">
        <p className="text-4xl" aria-hidden>{cards.length === 0 ? "🌿" : "✅"}</p>
        <h2 className="mt-2 font-display text-xl font-bold">{cards.length === 0 ? emptyTitle : "Done for now"}</h2>
        <p className="mt-1 text-sm text-neuron-muted">{cards.length === 0 ? emptyText : `${cards.length} reviewed. Each one is scheduled to come back just before you'd forget it.`}</p>
        <Link href="/" className="btn-secondary mt-4">Back to the feed</Link>
      </div>
    );
  }
  return (
    <div>
      <p className="mb-2 text-sm font-bold text-neuron-muted" aria-live="polite">{i + 1} of {cards.length}</p>
      <div className="h-[min(640px,72dvh)] [&>article]:!px-0">
        <CardView key={cards[i].key} card={cards[i]} active handlers={handlers} />
      </div>
      <div className="mt-3 flex justify-end">
        <button type="button" className="btn-primary" onClick={() => setI(i + 1)}>{i + 1 === cards.length ? "Finish" : "Next"}</button>
      </div>
      {sheet?.type === "dive" && <DeepDiveSheet deepDiveId={sheet.id} onClose={() => setSheet(null)} />}
      {sheet?.type === "ask" && <AskSheet card={sheet.card} onClose={() => setSheet(null)} />}
      {sheet?.type === "report" && <ReportSheet card={sheet.card} onClose={() => setSheet(null)} />}
    </div>
  );
}

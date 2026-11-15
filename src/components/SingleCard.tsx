"use client";

import { useCallback, useMemo, useState } from "react";
import type { FeedCard, CardEventName } from "@/lib/cardTypes";
import { CardView } from "./feed/CardView";
import type { CardHandlers } from "./feed/CardView";
import { AskSheet, DeepDiveSheet, ReportSheet } from "./feed/Sheets";

/** One card on its own page (from Saved, search, or a shared link). */
export function SingleCard({ card }: { card: FeedCard }) {
  const [sheet, setSheet] = useState<{ type: "dive"; id: number } | { type: "ask" } | { type: "report" } | null>(null);
  const onEvent = useCallback((cardId: number, event: CardEventName, value?: number) => {
    fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events: [{ cardId, event, value }] }), keepalive: true }).catch(() => {});
  }, []);
  const handlers: CardHandlers = useMemo(
    () => ({ onEvent, onOpenDeepDive: (id) => setSheet({ type: "dive", id }), onAsk: () => setSheet({ type: "ask" }), onReport: () => setSheet({ type: "report" }), onRefresh: () => {} }),
    [onEvent]
  );
  return (
    <div className="h-[min(680px,74dvh)] [&>article]:!px-0">
      <CardView card={card} active handlers={handlers} />
      {sheet?.type === "dive" && <DeepDiveSheet deepDiveId={sheet.id} onClose={() => setSheet(null)} />}
      {sheet?.type === "ask" && <AskSheet card={card} onClose={() => setSheet(null)} />}
      {sheet?.type === "report" && <ReportSheet card={card} onClose={() => setSheet(null)} />}
    </div>
  );
}

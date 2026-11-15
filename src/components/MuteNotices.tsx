"use client";

import { useState } from "react";
import { postJson } from "@/lib/ui";

export interface MuteNoticeItem {
  interestId: number;
  interestName: string;
  cardType: string;
  label: string;
}

/**
 * Tells the reader the feed has stopped showing a kind of card in a field
 * because they kept skipping it, and lets them bring it back. `compact`
 * is the one-line form used above the feed; the full form lists every mute.
 */
export function MuteNotices({ initial, compact = false }: { initial: MuteNoticeItem[]; compact?: boolean }) {
  const [items, setItems] = useState(initial);
  if (items.length === 0) return compact ? null : <p className="text-sm text-neuron-muted">Nothing is hidden. If you keep skipping one kind of card in a field, the feed will stop showing it there and tell you.</p>;

  async function act(n: MuteNoticeItem, action: "resume" | "dismiss") {
    setItems((prev) => prev.filter((x) => !(x.interestId === n.interestId && x.cardType === n.cardType)));
    await postJson("/api/mutes", { interestId: n.interestId, cardType: n.cardType, action });
  }

  return (
    <ul className={compact ? "space-y-2 px-4 pt-3 sm:px-6" : "space-y-2"} aria-label="Hidden card types">
      {items.map((n) => (
        <li key={`${n.interestId}-${n.cardType}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-neuron-border bg-neuron-surface p-3 text-sm" role="status">
          <span className="min-w-0 flex-1">
            {compact ? "You've been skipping" : "Hidden:"} <strong>{n.label}</strong> in <strong>{n.interestName}</strong>
            {compact ? ", so the feed has stopped showing them." : "."}
          </span>
          <button type="button" className="btn-secondary !min-h-[36px] !px-3 !py-1 !text-xs" onClick={() => act(n, "resume")}>Show them again</button>
          {compact && <button type="button" className="btn-ghost !min-h-[36px] !px-3 !py-1 !text-xs" onClick={() => act(n, "dismiss")}>OK</button>}
        </li>
      ))}
    </ul>
  );
}

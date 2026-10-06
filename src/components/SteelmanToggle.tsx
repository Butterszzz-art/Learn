"use client";

import { useState } from "react";
import { logEvent } from "@/lib/eventClient";
import { TrustBadge } from "./TrustBadge";

/** Collapsed by default — "See the other side" expands to the strongest
 * good-faith counterargument to this item's actual thesis. Only rendered
 * when steelmanContent exists (see ItemCard.tsx). Phase 14: logs its own
 * "expanded" engagement event (itemType "steelman", same items.id as the
 * parent News item) — distinct from that item's own "news" viewing, since
 * the Steelman companion is its own prunable content type. */
export function SteelmanToggle({
  content,
  itemId,
  interestId,
}: {
  content: string;
  itemId: number;
  interestId: number | null;
}) {
  const [open, setOpen] = useState(false);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) logEvent(itemId, "steelman", interestId, "expanded");
  }

  return (
    <div className="mt-3 border-t border-neuron-border pt-3">
      <button type="button" onClick={toggle} className="text-xs font-semibold text-neuron-accent3 hover:underline">
        {open ? "▾ Hide the other side" : "▸ See the other side"}
      </button>
      {open && (
        <>
          <p className="mt-2 text-xs leading-relaxed text-neuron-text/80">{content}</p>
          <div className="mt-2">
            <TrustBadge classification="synthesized" />
          </div>
        </>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";

/** Collapsed by default — "See the other side" expands to the strongest
 * good-faith counterargument to this item's actual thesis. Only rendered
 * when steelmanContent exists (see ItemCard.tsx). */
export function SteelmanToggle({ content }: { content: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 border-t border-neuron-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-semibold text-neuron-accent3 hover:underline"
      >
        {open ? "▾ Hide the other side" : "▸ See the other side"}
      </button>
      {open && <p className="mt-2 text-xs leading-relaxed text-neuron-text/80">{content}</p>}
    </div>
  );
}

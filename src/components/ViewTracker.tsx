"use client";

import { useEffect, useRef } from "react";
import type { PrunableContentType } from "@/db/schema";
import { logEvent } from "@/lib/eventClient";

/**
 * Phase 14 — wraps a card and logs a "viewed" event the first time it's
 * actually scrolled into view (IntersectionObserver, not on mount — Focus
 * mode renders every card in the deck up front, so an on-mount log would
 * mark everything "viewed" immediately and defeat the point of engagement
 * tracking). Fires at most once per mount.
 */
export function ViewTracker({
  itemId,
  itemType,
  interestId,
  children,
}: {
  itemId: number;
  itemType: PrunableContentType;
  interestId: number | null;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !firedRef.current) {
            firedRef.current = true;
            logEvent(itemId, itemType, interestId, "viewed");
            observer.disconnect();
          }
        }
      },
      { threshold: 0.6 }
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, itemType, interestId]);

  return <div ref={ref}>{children}</div>;
}

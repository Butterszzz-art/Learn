"use client";

import type { PrunableContentType, EngagementEventType } from "@/db/schema";

/**
 * Phase 14 — fire-and-forget engagement event logger, called from the UI
 * as the reader actually interacts with the stream. Never awaited by
 * callers and never throws — a failed log should never disrupt reading.
 */
export function logEvent(
  itemId: number,
  itemType: PrunableContentType,
  interestId: number | null,
  eventType: EngagementEventType
): void {
  try {
    fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, itemType, interestId, eventType }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore — logging an interaction should never break the interaction
  }
}

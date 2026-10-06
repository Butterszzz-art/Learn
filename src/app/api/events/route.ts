import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { logEngagementEvent } from "@/lib/engagement";
import { PRUNABLE_CONTENT_TYPES, ENGAGEMENT_EVENT_TYPES } from "@/db/schema";
import type { PrunableContentType, EngagementEventType } from "@/db/schema";

export const dynamic = "force-dynamic";

// Phase 14 — logs one reader interaction (viewed / expanded / answered /
// skipped) for the engagement-based pruning sweep to read later (see
// src/lib/engagement.ts). Best-effort: a failure here should never disrupt
// the reading experience, so it always returns 200 once the request is at
// least well-formed, and swallows any downstream DB error.
export async function POST(req: Request) {
  await ensureDb();
  const body = await req.json().catch(() => null);

  const itemId = Number(body?.itemId);
  const itemType = body?.itemType as PrunableContentType;
  const eventType = body?.eventType as EngagementEventType;
  const interestId = body?.interestId != null ? Number(body.interestId) : null;

  if (!Number.isFinite(itemId) || !(PRUNABLE_CONTENT_TYPES as readonly string[]).includes(itemType) || !(ENGAGEMENT_EVENT_TYPES as readonly string[]).includes(eventType)) {
    return NextResponse.json({ error: "itemId, itemType, and eventType are required" }, { status: 400 });
  }

  try {
    await logEngagementEvent(itemId, itemType, Number.isFinite(interestId as number) ? (interestId as number) : null, eventType);
  } catch (err) {
    console.error("[api/events] logEngagementEvent failed:", err);
  }
  return NextResponse.json({ ok: true });
}

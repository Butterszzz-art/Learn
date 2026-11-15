import { NextResponse } from "next/server";
import { apiUser, isResponse, readJson } from "@/lib/api";
import { recordEvents } from "@/lib/feed";
import type { CardEvent } from "@/lib/cardTypes";

export const dynamic = "force-dynamic";

const EVENTS = new Set(["impression", "dwell", "completed", "expanded", "saved", "unsaved", "shared", "skipped_fast", "quiz_correct", "quiz_incorrect", "go_deeper"]);

export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const body = await readJson<{ events?: CardEvent[] }>(req);
  const events = (Array.isArray(body?.events) ? body!.events : []).filter(
    (e) => e && Number.isInteger(e.cardId) && EVENTS.has(e.event)
  );
  await recordEvents(user.id, events);
  return NextResponse.json({ ok: true });
}

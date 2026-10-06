import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { dismissPruningNotice } from "@/lib/engagement";
import { PRUNABLE_CONTENT_TYPES } from "@/db/schema";
import type { PrunableContentType } from "@/db/schema";

export const dynamic = "force-dynamic";

// Phase 14 — dismisses the "switched to on-demand" notice without changing
// the mode itself; the content type stays on_demand, the reader just
// doesn't want to see the banner anymore.
export async function POST(req: Request) {
  await ensureDb();
  const body = await req.json().catch(() => null);
  const interestId = Number(body?.interestId);
  const contentType = body?.contentType as PrunableContentType;

  if (!Number.isFinite(interestId) || !(PRUNABLE_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    return NextResponse.json({ error: "interestId and contentType are required" }, { status: 400 });
  }

  await dismissPruningNotice(interestId, contentType);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { generateNowForContentType } from "@/lib/pipeline";
import { PRUNABLE_CONTENT_TYPES } from "@/db/schema";
import type { PrunableContentType } from "@/db/schema";

export const dynamic = "force-dynamic";

// Phase 14 — the "Generate now" action: an explicit, on-demand request for
// one piece of a content type that's currently on_demand for this interest
// (or any interest — the action works regardless of mode). Synchronous:
// the reader is waiting for this, so it never goes through the Batches API.
export async function POST(req: Request) {
  await ensureDb();
  const body = await req.json().catch(() => null);
  const interestId = Number(body?.interestId);
  const contentType = body?.contentType as PrunableContentType;

  if (!Number.isFinite(interestId) || !(PRUNABLE_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    return NextResponse.json({ error: "interestId and contentType are required" }, { status: 400 });
  }

  const result = await generateNowForContentType(interestId, contentType);
  return NextResponse.json(result);
}

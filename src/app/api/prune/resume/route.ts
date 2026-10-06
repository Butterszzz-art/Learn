import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { resumeAutoGeneration } from "@/lib/engagement";
import { PRUNABLE_CONTENT_TYPES } from "@/db/schema";
import type { PrunableContentType } from "@/db/schema";

export const dynamic = "force-dynamic";

// Phase 14 — the pruning notice's "Turn back on" action: switches an
// (interest, contentType) combination back to auto-generation. Always
// available regardless of current engagement, per spec.
export async function POST(req: Request) {
  await ensureDb();
  const body = await req.json().catch(() => null);
  const interestId = Number(body?.interestId);
  const contentType = body?.contentType as PrunableContentType;

  if (!Number.isFinite(interestId) || !(PRUNABLE_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    return NextResponse.json({ error: "interestId and contentType are required" }, { status: 400 });
  }

  await resumeAutoGeneration(interestId, contentType);
  return NextResponse.json({ ok: true });
}

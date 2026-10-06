import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { refreshSteelmansForInterest } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
// Phase 13: Steelman moved off the daily News step to its own weekly,
// per-interest step (see pipeline.ts) — uses web_search, similar cost/
// latency profile to a Field News Roundup generation. Comfortably within
// Vercel Hobby's 60s cap. Idempotent per week — safe to retry, tops up to
// STEELMAN_TARGET_PER_INTEREST rather than duplicating.
export const maxDuration = 60;

export async function POST(req: Request) {
  await ensureDb();
  const body = await req.json().catch(() => null);
  const interestId = Number(body?.interestId);
  if (!Number.isFinite(interestId)) {
    return NextResponse.json({ error: "interestId is required" }, { status: 400 });
  }

  try {
    const added = await refreshSteelmansForInterest(interestId);
    return NextResponse.json({ added });
  } catch (err) {
    console.error("[api/refresh/steelman] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Steelman refresh failed" },
      { status: 500 }
    );
  }
}

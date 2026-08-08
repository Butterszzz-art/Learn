import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { runDigestPipeline } from "@/lib/pipeline";

// All-at-once refresh — every enabled interest's News + Deep Dive + Applied
// Insight in one request. Fine locally (no time limit), but this can run
// several minutes for multiple interests, which risks a timeout on
// serverless hosts. The deployed UI calls the granular
// /api/refresh/{news,deep-dive,insight} endpoints instead, one interest/step
// per request. Kept here for the CLI script and manual testing.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  await ensureDb();
  try {
    const result = await runDigestPipeline();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/refresh] Pipeline failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Refresh failed" },
      { status: 500 }
    );
  }
}

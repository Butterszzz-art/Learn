import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { refreshMentalModelsForCycle } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
// Cycle-level (not per-interest), no web_search — a handful of fast
// json_schema calls at most (tries up to 3 candidate models per pick, up to
// MENTAL_MODEL_WEEKLY_TARGET picks). Comfortably within Vercel Hobby's 60s
// cap. Idempotent per cycle — safe to retry, tops up rather than duplicating.
export const maxDuration = 60;

export async function POST() {
  await ensureDb();
  try {
    const added = await refreshMentalModelsForCycle();
    return NextResponse.json({ added });
  } catch (err) {
    console.error("[api/refresh/mental-model] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Mental model refresh failed" },
      { status: 500 }
    );
  }
}

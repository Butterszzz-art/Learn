import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { refreshDrillsForCycle } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
// Cycle-level (not per-interest), and no web_search involved — up to 3
// fast json_schema Claude calls (2 grounded + 1 standalone), each similar
// in cost to a self-check/follow-up generation. Should comfortably fit
// Vercel Hobby's 60s cap. Idempotent per part (grounded vs. standalone), so
// a retry after a timeout never duplicates — see refreshDrillsForCycle.
export const maxDuration = 60;

export async function POST() {
  await ensureDb();
  try {
    const result = await refreshDrillsForCycle();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/refresh/drills] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Drills refresh failed" },
      { status: 500 }
    );
  }
}

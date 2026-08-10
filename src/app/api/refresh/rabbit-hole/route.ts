import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { refreshRabbitHoleForCycle } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
// Cycle-level (not per-interest). Uses web_search, similar cost/latency
// profile to a Field News Roundup generation — comfortably within Vercel
// Hobby's 60s cap in nearly all cases. Idempotent per cycle — safe to retry.
export const maxDuration = 60;

export async function POST() {
  await ensureDb();
  try {
    const added = await refreshRabbitHoleForCycle();
    return NextResponse.json({ added });
  } catch (err) {
    console.error("[api/refresh/rabbit-hole] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Rabbit hole refresh failed" },
      { status: 500 }
    );
  }
}

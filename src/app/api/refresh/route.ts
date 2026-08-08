import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { runDigestPipeline } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

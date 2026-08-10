import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { refreshBookChapterForCycle } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
// Cycle-level (not per-interest). No Claude call for the surfacing itself
// (that already happened at upload time) — just a covered-topics log write
// per key concept plus one fast grounded-drill generation per newly-
// surfaced chapter. Comfortably within Vercel Hobby's 60s cap.
export const maxDuration = 60;

export async function POST() {
  await ensureDb();
  try {
    const result = await refreshBookChapterForCycle();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/refresh/book-chapter] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Book chapter refresh failed" },
      { status: 500 }
    );
  }
}

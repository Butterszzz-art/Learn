import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { processNextChapter } from "@/lib/libraryPipeline";

export const dynamic = "force-dynamic";
// One chapter's worth of Claude calls (possibly windowed for a long
// chapter, run in parallel) reading the PDF. The client calls this
// repeatedly, once per chapter, until done=true — same granular-loop
// pattern as RefreshButton.tsx's deep-dive loop. Idempotent per chapter.
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  await ensureDb();
  const bookId = Number(params.id);
  if (!Number.isFinite(bookId)) {
    return NextResponse.json({ error: "Invalid book id" }, { status: 400 });
  }

  try {
    const result = await processNextChapter(bookId);
    if (!result) {
      return NextResponse.json({ error: "Book not found, not in a processing state, or no API key is configured" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/library/process-chapter] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Chapter processing failed" },
      { status: 500 }
    );
  }
}

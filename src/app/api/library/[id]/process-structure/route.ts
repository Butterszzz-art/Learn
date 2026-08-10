import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { processBookStructure } from "@/lib/libraryPipeline";

export const dynamic = "force-dynamic";
// One Claude call reading the whole PDF to identify structure — can take a
// while for a long book. 300s is Vercel's Pro ceiling; Hobby caps at 60s
// regardless. Idempotent — checking existing chapters before doing
// anything, so a timeout is safe to retry.
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  await ensureDb();
  const bookId = Number(params.id);
  if (!Number.isFinite(bookId)) {
    return NextResponse.json({ error: "Invalid book id" }, { status: 400 });
  }

  try {
    const result = await processBookStructure(bookId);
    if (!result) {
      return NextResponse.json({ error: "Book not found, or no API key is configured" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/library/process-structure] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Structure processing failed" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { createBook } from "@/lib/libraryPipeline";

export const dynamic = "force-dynamic";
// Just reads the upload and writes one row — no Claude call here (that's
// process-structure/process-chapter, called separately by the client after
// this returns). Comfortably fast regardless of file size.
export const maxDuration = 60;

// Generous but bounded — matches Anthropic's own PDF document size ceiling
// closely enough that an oversized upload fails here with a clear message
// rather than as an opaque API error later.
const MAX_FILE_BYTES = 32 * 1024 * 1024;

export async function POST(req: Request) {
  await ensureDb();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A PDF file is required" }, { status: 400 });
  }
  if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF files are supported for now" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File is too large (${Math.round(file.size / 1024 / 1024)}MB) — the limit is 32MB.` },
      { status: 400 }
    );
  }

  const paceWeeksRaw = form.get("paceWeeks");
  const paceWeeks = typeof paceWeeksRaw === "string" && paceWeeksRaw.trim() ? Number(paceWeeksRaw) : null;
  const paceWeeksRequested = paceWeeks && Number.isFinite(paceWeeks) && paceWeeks > 0 ? Math.round(paceWeeks) : null;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");
    const result = await createBook(file.name, base64, paceWeeksRequested);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/library/upload] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload failed" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { createBook } from "@/lib/libraryPipeline";

export const dynamic = "force-dynamic";
// Just reads the upload/URL and writes one row — no Claude call here
// (that's process-structure/process-chapter, called separately by the
// client after this returns). Comfortably fast regardless of file size.
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

  const paceWeeksRaw = form.get("paceWeeks");
  const paceWeeks = typeof paceWeeksRaw === "string" && paceWeeksRaw.trim() ? Number(paceWeeksRaw) : null;
  const paceWeeksRequested = paceWeeks && Number.isFinite(paceWeeks) && paceWeeks > 0 ? Math.round(paceWeeks) : null;

  // Phase 11: a pasted article URL is a valid "book" source too — no file
  // involved, just a single-chapter note built from the fetched page.
  const urlField = form.get("url");
  if (typeof urlField === "string" && urlField.trim()) {
    const url = urlField.trim();
    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: "Enter a valid http(s) URL" }, { status: 400 });
    }
    try {
      const result = await createBook(url, "", paceWeeksRequested, "url_article", url);
      return NextResponse.json(result);
    } catch (err) {
      console.error("[api/library/upload] URL create failed:", err);
      return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't save this URL" }, { status: 500 });
    }
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A PDF or EPUB file, or an article URL, is required" }, { status: 400 });
  }

  const lowerName = file.name.toLowerCase();
  const isPdf = file.type === "application/pdf" || lowerName.endsWith(".pdf");
  const isEpub = file.type === "application/epub+zip" || lowerName.endsWith(".epub");
  if (!isPdf && !isEpub) {
    return NextResponse.json({ error: "Only PDF and EPUB files are supported" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File is too large (${Math.round(file.size / 1024 / 1024)}MB) — the limit is 32MB.` },
      { status: 400 }
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");
    const result = await createBook(file.name, base64, paceWeeksRequested, isPdf ? "pdf" : "epub");
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/library/upload] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload failed" }, { status: 500 });
  }
}

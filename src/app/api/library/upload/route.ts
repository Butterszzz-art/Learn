import { NextResponse } from "next/server";
import { apiUser, fail, isResponse, logError } from "@/lib/api";
import { createBook } from "@/lib/libraryPipeline";
import { checkQuota } from "@/lib/plan";
import { enqueue } from "@/lib/engine/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Anthropic's PDF document support caps a single request at 32MB.
const MAX_FILE_BYTES = 32 * 1024 * 1024;

export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const quota = await checkQuota(user.id, user.plan, "libraryBook");
  if (!quota.ok) return fail(quota.message, 402);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Expected multipart/form-data");
  }
  const paceWeeksRaw = form.get("paceWeeks");
  const paceWeeks = typeof paceWeeksRaw === "string" && paceWeeksRaw.trim() ? Number(paceWeeksRaw) : null;
  const pace = paceWeeks && Number.isFinite(paceWeeks) && paceWeeks > 0 ? Math.round(paceWeeks) : null;

  try {
    let bookId: number;
    const urlField = form.get("url");
    if (typeof urlField === "string" && urlField.trim()) {
      const url = urlField.trim();
      if (!/^https?:\/\//i.test(url)) return fail("Enter a valid http(s) URL");
      bookId = (await createBook(user.id, url, "", pace, "url_article", url)).id;
    } else {
      const file = form.get("file");
      if (!(file instanceof File)) return fail("A PDF or EPUB file, or an article URL, is required");
      const lower = file.name.toLowerCase();
      const isPdf = file.type === "application/pdf" || lower.endsWith(".pdf");
      const isEpub = file.type === "application/epub+zip" || lower.endsWith(".epub");
      if (!isPdf && !isEpub) return fail("Only PDF and EPUB files are supported");
      if (file.size > MAX_FILE_BYTES) return fail(`File is too large (${Math.round(file.size / 1024 / 1024)}MB) — the limit is 32MB.`);
      const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
      bookId = (await createBook(user.id, file.name, base64, pace, isPdf ? "pdf" : "epub")).id;
    }
    await enqueue("book_structure", { bookId }, { userId: user.id });
    return NextResponse.json({ id: bookId });
  } catch (err) {
    await logError("library", "upload failed", err, user.id);
    return fail("Upload failed", 500);
  }
}

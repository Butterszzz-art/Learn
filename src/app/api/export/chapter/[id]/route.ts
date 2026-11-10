import { NextResponse } from "next/server";
import { apiUser, fail, isResponse } from "@/lib/api";
import { getChapterById } from "@/lib/content";
import { buildChapterMarkdown, markdownToPdf, exportFilename } from "@/lib/export";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const id = Number(params.id);
  if (!Number.isFinite(id)) return fail("Invalid id");
  const detail = await getChapterById(id, user.id);
  if (!detail) return fail("Not found", 404);
  const markdown = buildChapterMarkdown(detail);
  const title = detail.title;
  const filename = exportFilename(new Date().toISOString(), `${detail.chapterNumber}-${detail.title}`);
  const format = new URL(req.url).searchParams.get("format") === "pdf" ? "pdf" : "md";
  if (format === "pdf") {
    const pdf = await markdownToPdf(markdown, title);
    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename.replace(/\.md$/, ".pdf")}"`,
      },
    });
  }
  return new NextResponse(markdown, {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` },
  });
}

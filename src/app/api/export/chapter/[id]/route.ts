import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { getChapterById } from "@/lib/digest";
import { buildChapterMarkdown, markdownToPdf, exportFilename } from "@/lib/export";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: { id: string } }) {
  await ensureDb();
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const detail = await getChapterById(id);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const format = new URL(req.url).searchParams.get("format") === "pdf" ? "pdf" : "md";
  const markdown = buildChapterMarkdown(detail);
  const filename = exportFilename(new Date().toISOString(), `${detail.chapterNumber}-${detail.title}`);

  if (format === "pdf") {
    const pdf = await markdownToPdf(markdown, detail.title);
    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename.replace(/\.md$/, ".pdf")}"`,
      },
    });
  }

  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

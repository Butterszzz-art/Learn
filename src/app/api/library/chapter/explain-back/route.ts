import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { submitChapterExplainBack } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  await ensureDb();
  const body = await req.json().catch(() => null);
  const chapterId = Number(body?.chapterId);
  const userExplanation = typeof body?.userExplanation === "string" ? body.userExplanation : "";
  if (!Number.isFinite(chapterId) || !userExplanation.trim()) {
    return NextResponse.json({ error: "chapterId and a non-empty userExplanation are required" }, { status: 400 });
  }

  try {
    const result = await submitChapterExplainBack(chapterId, userExplanation);
    if (!result) {
      return NextResponse.json(
        { error: "Couldn't generate feedback — the chapter may not exist or isn't processed yet, or no API key is configured." },
        { status: 404 }
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/library/chapter/explain-back] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Explain-back failed" }, { status: 500 });
  }
}

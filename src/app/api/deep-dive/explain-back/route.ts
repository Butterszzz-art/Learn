import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { submitExplainBack } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
// A single fast json_schema call, no web_search — comfortably within
// Vercel Hobby's 60s cap. Live user action, not a refresh step — a retry
// creates another explain-back attempt rather than being a no-op, which is
// fine here (multiple practice attempts on the same dive are expected).
export const maxDuration = 60;

export async function POST(req: Request) {
  await ensureDb();
  const body = await req.json().catch(() => null);
  const deepDiveId = Number(body?.deepDiveId);
  const userExplanation = typeof body?.userExplanation === "string" ? body.userExplanation : "";
  if (!Number.isFinite(deepDiveId) || !userExplanation.trim()) {
    return NextResponse.json({ error: "deepDiveId and a non-empty userExplanation are required" }, { status: 400 });
  }

  try {
    const result = await submitExplainBack(deepDiveId, userExplanation);
    if (!result) {
      return NextResponse.json(
        { error: "Couldn't generate feedback — the deep dive may not exist, or no API key is configured." },
        { status: 404 }
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/deep-dive/explain-back] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Explain-back failed" },
      { status: 500 }
    );
  }
}

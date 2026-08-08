import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { refreshDeepDiveForInterest } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
// Deep-dive generation (web_search + long-form writing) is the slowest
// step — observed taking several minutes for research-level topics with
// many sources. 300s is Vercel's ceiling on the Pro plan; Hobby caps at 60s
// regardless of this value, so the heaviest topics may time out there. A
// timed-out generation is harmless to retry — refreshDeepDiveForInterest
// checks for an existing dive before generating, so the next refresh just
// tries again rather than duplicating or losing state.
export const maxDuration = 300;

export async function POST(req: Request) {
  await ensureDb();
  const body = await req.json().catch(() => null);
  const interestId = Number(body?.interestId);
  if (!Number.isFinite(interestId)) {
    return NextResponse.json({ error: "interestId is required" }, { status: 400 });
  }

  try {
    const result = await refreshDeepDiveForInterest(interestId);
    if (!result) {
      return NextResponse.json({ error: "Interest not found or not enabled" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/refresh/deep-dive] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Deep dive refresh failed" },
      { status: 500 }
    );
  }
}

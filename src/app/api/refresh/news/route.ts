import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { refreshNewsForInterest } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
// News (RSS/API fetch or a web-search roundup) is the fastest step — should
// comfortably fit Vercel Hobby's 60s cap in nearly all cases.
export const maxDuration = 60;

export async function POST(req: Request) {
  await ensureDb();
  const body = await req.json().catch(() => null);
  const interestId = Number(body?.interestId);
  if (!Number.isFinite(interestId)) {
    return NextResponse.json({ error: "interestId is required" }, { status: 400 });
  }

  try {
    const result = await refreshNewsForInterest(interestId);
    if (!result) {
      return NextResponse.json({ error: "Interest not found or not enabled" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/refresh/news] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "News refresh failed" },
      { status: 500 }
    );
  }
}

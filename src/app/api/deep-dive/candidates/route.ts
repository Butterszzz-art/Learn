import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { getInterestById, getCoveredTopics } from "@/lib/interests";
import { generateCandidateTopics } from "@/lib/deepDive";
import { hasClaudeKey } from "@/lib/claude";

export const dynamic = "force-dynamic";
// No web_search involved (topic selection, not research) — comfortably fast.
export const maxDuration = 60;

export async function POST(req: Request) {
  await ensureDb();
  const body = await req.json().catch(() => null);
  const interestId = Number(body?.interestId);
  if (!Number.isFinite(interestId)) {
    return NextResponse.json({ error: "interestId is required" }, { status: 400 });
  }

  const interest = await getInterestById(interestId);
  if (!interest || !interest.enabled) {
    return NextResponse.json({ error: "Interest not found or not enabled" }, { status: 404 });
  }
  if (!hasClaudeKey()) {
    return NextResponse.json({ candidates: [] });
  }

  try {
    const covered = await getCoveredTopics(interest.id);
    const candidates = await generateCandidateTopics(interest.name, interest.level, covered);
    return NextResponse.json({ candidates });
  } catch (err) {
    console.error("[api/deep-dive/candidates] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Candidate generation failed" },
      { status: 500 }
    );
  }
}

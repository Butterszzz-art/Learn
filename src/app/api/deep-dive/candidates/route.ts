import { NextResponse } from "next/server";
import { apiUser, fail, isResponse, readJson } from "@/lib/api";
import { getUserInterest, getSeriesTopics } from "@/lib/interests";
import { generateCandidateTopics } from "@/lib/deepDive";
import { hasClaudeKey, withAiContext } from "@/lib/ai";
import { checkQuota } from "@/lib/plan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const body = await readJson<{ interestId?: number }>(req);
  if (typeof body?.interestId !== "number") return fail("interestId is required");
  const interest = await getUserInterest(user.id, body.interestId);
  if (!interest || !interest.enabled) return fail("Interest not found or not enabled", 404);
  if (!hasClaudeKey()) return NextResponse.json({ candidates: [] });
  const quota = await checkQuota(user.id, user.plan, "onDemandDive");
  if (!quota.ok) return fail(quota.message, 402);

  const covered = await getSeriesTopics(interest.id, interest.level);
  const candidates = await withAiContext({ userId: user.id, purpose: "candidates" }, () =>
    generateCandidateTopics(interest.name, interest.level, covered)
  );
  return NextResponse.json({ candidates });
}

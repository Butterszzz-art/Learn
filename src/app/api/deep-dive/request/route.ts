import { NextResponse } from "next/server";
import { apiUser, fail, isResponse, readJson } from "@/lib/api";
import { getUserInterest } from "@/lib/interests";
import { hasClaudeKey } from "@/lib/ai";
import { checkQuota } from "@/lib/plan";
import { enqueue } from "@/lib/engine/jobs";
import { findTopicDive } from "@/lib/engine/series";

export const dynamic = "force-dynamic";

/**
 * "Go deeper on this topic" — from a follow-up card or the pick-your-next-
 * topic list. If someone has already had this topic written at this level
 * it opens instantly; otherwise a job is queued and the client polls it.
 */
export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const body = await readJson<{ interestId?: number; topic?: string }>(req);
  const topic = typeof body?.topic === "string" ? body.topic.trim().slice(0, 140) : "";
  if (typeof body?.interestId !== "number" || topic.length < 3) return fail("interestId and topic are required");

  const interest = await getUserInterest(user.id, body.interestId);
  if (!interest) return fail("Interest not found", 404);

  const existing = await findTopicDive(interest.id, interest.level, topic);
  if (existing) return NextResponse.json({ deepDiveId: existing });

  if (!hasClaudeKey()) return fail("Content generation isn't configured on this server", 503);
  const quota = await checkQuota(user.id, user.plan, "onDemandDive");
  if (!quota.ok) return fail(quota.message, 402);

  const jobId = await enqueue("topic_dive", { interestId: interest.id, level: interest.level, topic }, { userId: user.id });
  return NextResponse.json({ jobId });
}

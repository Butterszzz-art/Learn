import { NextResponse } from "next/server";
import { apiUser, fail, isResponse, readJson, logError } from "@/lib/api";
import { hasOpenRouterKey, runResearchAgent } from "@/lib/researchAgent";
import { checkQuota } from "@/lib/plan";
import { client } from "@/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  if (!hasOpenRouterKey()) return fail("The Research Agent isn't configured on this server.", 501);
  const body = await readJson<{ question?: string }>(req);
  const question = typeof body?.question === "string" ? body.question.trim().slice(0, 1000) : "";
  if (!question) return fail("A question is required.");
  const quota = await checkQuota(user.id, user.plan, "research");
  if (!quota.ok) return fail(quota.message, 402);

  // Counted up front so a slow or failed run still uses one of the day's questions.
  await client.execute({
    sql: "INSERT INTO ai_usage (user_id, purpose, model, cost_usd) VALUES (?, 'research', ?, 0)",
    args: [user.id, `openrouter:${process.env.OPENROUTER_MODEL || "default"}`],
  });
  try {
    return NextResponse.json(await runResearchAgent(question));
  } catch (err) {
    await logError("research", "agent failed", err, user.id);
    return fail("The Research Agent couldn't finish that one. Try again, or rephrase the question.", 502);
  }
}

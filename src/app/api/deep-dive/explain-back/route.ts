import { NextResponse } from "next/server";
import { apiUser, fail, isResponse, readJson } from "@/lib/api";
import { submitExplainBack } from "@/lib/content";
import { hasClaudeKey, withAiContext } from "@/lib/ai";
import { checkQuota } from "@/lib/plan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const body = await readJson<{ deepDiveId?: number; explanation?: string }>(req);
  const text = typeof body?.explanation === "string" ? body.explanation.trim() : "";
  if (typeof body?.deepDiveId !== "number" || text.length < 20) return fail("Write at least a couple of sentences first");
  if (text.length > 6000) return fail("That's too long — keep it under 6,000 characters");
  if (!hasClaudeKey()) return fail("Feedback isn't configured on this server", 503);
  const quota = await checkQuota(user.id, user.plan, "explainBack");
  if (!quota.ok) return fail(quota.message, 402);

  const result = await withAiContext({ userId: user.id, purpose: "explain_back" }, () =>
    submitExplainBack(user.id, body.deepDiveId!, text)
  );
  if (!result) return fail("Couldn't generate feedback just now — try again", 502);
  return NextResponse.json(result);
}

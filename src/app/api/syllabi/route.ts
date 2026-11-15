import { NextResponse } from "next/server";
import { apiUser, fail, isResponse, readJson, logError } from "@/lib/api";
import { getSyllabiForInterest, createSyllabus } from "@/lib/syllabus";
import { getUserInterest } from "@/lib/interests";
import { checkQuota } from "@/lib/plan";
import { hasClaudeKey, withAiContext } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const interestId = Number(new URL(req.url).searchParams.get("interestId"));
  if (!Number.isFinite(interestId)) return fail("interestId query param is required");
  return NextResponse.json(await getSyllabiForInterest(user.id, interestId));
}

export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const body = await readJson<{ interestId?: number; name?: string; rawContent?: string }>(req);
  const interestId = Number(body?.interestId);
  const name = typeof body?.name === "string" ? body.name.slice(0, 120) : "";
  const rawContent = typeof body?.rawContent === "string" ? body.rawContent : "";
  if (!Number.isFinite(interestId) || !rawContent.trim()) return fail("interestId and rawContent are required");
  if (rawContent.length > 200_000) return fail("That syllabus is too long — paste the topic and reading list only");
  if (!(await getUserInterest(user.id, interestId))?.enabled) return fail("Follow that interest first", 404);
  if (!hasClaudeKey()) return fail("Syllabus parsing isn't configured on this server", 503);
  const quota = await checkQuota(user.id, user.plan, "syllabus");
  if (!quota.ok) return fail(quota.message, 402);
  try {
    const syllabus = await withAiContext({ userId: user.id, purpose: "syllabus_parse" }, () => createSyllabus(user.id, interestId, name, rawContent));
    return NextResponse.json(syllabus);
  } catch (err) {
    await logError("syllabus", "create failed", err, user.id);
    return fail(err instanceof Error ? err.message : "Couldn't parse this syllabus", 422);
  }
}

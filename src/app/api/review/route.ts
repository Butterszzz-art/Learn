import { NextResponse } from "next/server";
import { apiUser, fail, isResponse, readJson } from "@/lib/api";
import { gradeConcept, countDue } from "@/lib/learning";
import { client } from "@/db";

export const dynamic = "force-dynamic";

/** Self-graded recall ("Forgot" / "Got it" / "Easy") for a concept. */
export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const body = await readJson<{ conceptId?: number; grade?: string }>(req);
  if (typeof body?.conceptId !== "number" || !["again", "good", "easy"].includes(body.grade ?? "")) return fail("conceptId and grade are required");
  // Only concepts this person may see: shared ones, or their own Library ones.
  const res = await client.execute({ sql: "SELECT owner_user_id FROM concepts WHERE id = ?", args: [body.conceptId] });
  const row = res.rows[0] as any;
  if (!row || (row.owner_user_id !== null && Number(row.owner_user_id) !== user.id)) return fail("Not found", 404);
  const next = await gradeConcept(user.id, body.conceptId, body.grade as "again" | "good" | "easy");
  return NextResponse.json({ due: next.due, remaining: await countDue(user.id) });
}

import { NextResponse } from "next/server";
import { apiUser, fail, isResponse, readJson } from "@/lib/api";
import { createCustomInterest, setUserInterest } from "@/lib/interests";
import { checkQuota } from "@/lib/plan";
import { LEVELS } from "@/db/schema";
import type { Level } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const body = await readJson<{ name?: string; level?: string }>(req);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 60) return fail("Give the interest a name between 2 and 60 characters");
  const quota = await checkQuota(user.id, user.plan, "customInterest");
  if (!quota.ok) return fail(quota.message, 402);
  const level = ((LEVELS as readonly string[]).includes(body?.level ?? "") ? body!.level : "some_background") as Level;
  try {
    const interest = await createCustomInterest(user.id, name);
    await setUserInterest(user.id, interest.id, level === "research_level" && user.plan !== "pro" ? "advanced" : level, true);
    return NextResponse.json({ ...interest, level, enabled: true, isFavorite: false });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Couldn't add that interest");
  }
}

import { NextResponse } from "next/server";
import { apiUser, fail, isResponse, readJson } from "@/lib/api";
import { getCatalog, saveUserInterests, setIsFavorite } from "@/lib/interests";
import { markOnboarded } from "@/lib/auth";
import { PLAN_LIMITS } from "@/lib/plan";
import { planWork } from "@/lib/engine/scheduler";
import { LEVELS } from "@/db/schema";
import type { Level } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await apiUser();
  if (isResponse(user)) return user;
  return NextResponse.json(await getCatalog(user.id));
}

export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const body = await readJson(req);
  if (!body || !Array.isArray(body.interests)) return fail("Expected { interests: [...] }");

  const catalog = await getCatalog(user.id);
  const known = new Set(catalog.map((i) => i.id));
  const allowResearch = PLAN_LIMITS[user.plan].researchLevel;
  const updates: { interestId: number; level: Level; enabled: boolean; isFavorite?: boolean }[] = [];
  for (const e of body.interests) {
    if (typeof e?.interestId !== "number" || !known.has(e.interestId)) continue;
    if (typeof e.enabled !== "boolean" || !(LEVELS as readonly string[]).includes(e.level)) continue;
    // Research level is a Pro feature; a free account is kept at "advanced".
    const level: Level = e.level === "research_level" && !allowResearch ? "advanced" : e.level;
    updates.push({ interestId: e.interestId, level, enabled: e.enabled, isFavorite: typeof e.isFavorite === "boolean" ? e.isFavorite : undefined });
  }
  if (updates.length === 0) return fail("No valid interest updates");

  await saveUserInterests(user.id, updates);
  for (const u of updates) if (u.isFavorite !== undefined) await setIsFavorite(user.id, u.interestId, u.isFavorite);
  if (updates.some((u) => u.enabled)) await markOnboarded(user.id);
  // Start generating anything this person's choices need that the pool lacks.
  await planWork(user.id).catch(() => {});
  return NextResponse.json(await getCatalog(user.id));
}

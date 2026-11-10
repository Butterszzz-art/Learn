import { NextResponse } from "next/server";
import { apiUser, isResponse, readJson } from "@/lib/api";
import { updatePrefs } from "@/lib/auth";
import type { UserPrefs } from "@/db/schema";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await apiUser();
  if (isResponse(user)) return user;
  return NextResponse.json({ prefs: user.prefs, plan: user.plan, email: user.email, displayName: user.displayName });
}

export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const body = (await readJson(req)) ?? {};
  const patch: Partial<UserPrefs> = {};
  if (typeof body.includeBrainGames === "boolean") patch.includeBrainGames = body.includeBrainGames;
  if (typeof body.streakOptIn === "boolean") patch.streakOptIn = body.streakOptIn;
  if (["system", "light", "dark"].includes(body.theme)) patch.theme = body.theme;
  if (Number.isInteger(body.dailyGoal) && body.dailyGoal >= 0 && body.dailyGoal <= 200) patch.dailyGoal = body.dailyGoal;
  if (body.notifyHour === null || (Number.isInteger(body.notifyHour) && body.notifyHour >= 0 && body.notifyHour <= 23)) patch.notifyHour = body.notifyHour;
  if (typeof body.textScale === "number" && body.textScale >= 0.85 && body.textScale <= 1.4) patch.textScale = body.textScale;
  if (typeof body.displayName === "string") {
    await db.update(users).set({ displayName: body.displayName.trim().slice(0, 40) || null }).where(eq(users.id, user.id));
  }
  const prefs = await updatePrefs(user.id, patch);
  return NextResponse.json({ prefs });
}

import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { getAllInterests, saveUserInterests, setGeneratesAppliedInsights, setIsFavorite } from "@/lib/interests";
import { LEVELS } from "@/db/schema";
import type { Level } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDb();
  return NextResponse.json(await getAllInterests());
}

interface UpdatePayload {
  interestId: number;
  level: Level;
  enabled: boolean;
  generatesAppliedInsights?: boolean;
  isFavorite?: boolean;
}

export async function POST(req: Request) {
  await ensureDb();
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.interests)) {
    return NextResponse.json({ error: "Invalid body — expected { interests: [...] }" }, { status: 400 });
  }

  const updates: UpdatePayload[] = [];
  for (const entry of body.interests) {
    if (
      typeof entry?.interestId !== "number" ||
      typeof entry?.enabled !== "boolean" ||
      !(LEVELS as readonly string[]).includes(entry?.level)
    ) {
      continue;
    }
    updates.push({
      interestId: entry.interestId,
      level: entry.level,
      enabled: entry.enabled,
      generatesAppliedInsights:
        typeof entry.generatesAppliedInsights === "boolean" ? entry.generatesAppliedInsights : undefined,
      isFavorite: typeof entry.isFavorite === "boolean" ? entry.isFavorite : undefined,
    });
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No valid interest updates in body" }, { status: 400 });
  }

  await saveUserInterests(updates.map(({ interestId, level, enabled }) => ({ interestId, level, enabled })));
  for (const u of updates) {
    if (u.generatesAppliedInsights !== undefined) {
      await setGeneratesAppliedInsights(u.interestId, u.generatesAppliedInsights);
    }
    if (u.isFavorite !== undefined) {
      await setIsFavorite(u.interestId, u.isFavorite);
    }
  }

  return NextResponse.json(await getAllInterests());
}

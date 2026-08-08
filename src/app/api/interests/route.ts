import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { getAllInterests, saveUserInterests } from "@/lib/interests";
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
    updates.push({ interestId: entry.interestId, level: entry.level, enabled: entry.enabled });
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No valid interest updates in body" }, { status: 400 });
  }

  await saveUserInterests(updates);
  return NextResponse.json(await getAllInterests());
}

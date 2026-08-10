import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { getAppSettings, updateAppSettings } from "@/lib/digest";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDb();
  return NextResponse.json(await getAppSettings());
}

export async function POST(req: Request) {
  await ensureDb();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const update: { frequency?: "daily" | "weekly"; includeBrainGames?: boolean } = {};
  if (body.frequency === "daily" || body.frequency === "weekly") {
    update.frequency = body.frequency;
  }
  if (typeof body.includeBrainGames === "boolean") {
    update.includeBrainGames = body.includeBrainGames;
  }

  await updateAppSettings(update);
  return NextResponse.json(await getAppSettings());
}

import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { getAppSettings, updateAppSettings } from "@/lib/digest";
import { isValidCategory } from "@/lib/categorize";
import type { Category } from "@/db/schema";

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

  const update: { frequency?: "daily" | "weekly"; mutedCategories?: Category[] } = {};

  if (body.frequency === "daily" || body.frequency === "weekly") {
    update.frequency = body.frequency;
  }

  if (Array.isArray(body.mutedCategories)) {
    update.mutedCategories = body.mutedCategories.filter(
      (c: unknown): c is Category => typeof c === "string" && isValidCategory(c)
    );
  }

  await updateAppSettings(update);
  return NextResponse.json(await getAppSettings());
}

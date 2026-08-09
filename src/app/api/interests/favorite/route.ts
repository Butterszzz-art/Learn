import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { setIsFavorite } from "@/lib/interests";

export const dynamic = "force-dynamic";

// Single-field toggle so the feed's star button doesn't need to round-trip
// the whole interests list like the Settings page's bulk save does.
export async function POST(req: Request) {
  await ensureDb();
  const body = await req.json().catch(() => null);
  const interestId = Number(body?.interestId);
  const isFavorite = body?.isFavorite;
  if (!Number.isFinite(interestId) || typeof isFavorite !== "boolean") {
    return NextResponse.json({ error: "interestId (number) and isFavorite (boolean) are required" }, { status: 400 });
  }

  await setIsFavorite(interestId, isFavorite);
  return NextResponse.json({ interestId, isFavorite });
}

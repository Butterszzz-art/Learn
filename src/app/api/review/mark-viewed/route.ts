import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { markTopicReviewed } from "@/lib/interests";

export const dynamic = "force-dynamic";

// Called when a "Remember this?" resurfaced card is actually opened/read —
// pushes that topic's next spaced-review date further out (3 -> 7 -> 21 ->
// 60 days). Not called just for the card being shown, only for being opened.
export async function POST(req: Request) {
  await ensureDb();
  const body = await req.json().catch(() => null);
  const coveredTopicId = Number(body?.coveredTopicId);
  if (!Number.isFinite(coveredTopicId)) {
    return NextResponse.json({ error: "coveredTopicId is required" }, { status: 400 });
  }

  await markTopicReviewed(coveredTopicId);
  return NextResponse.json({ ok: true });
}

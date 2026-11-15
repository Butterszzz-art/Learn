import { NextResponse } from "next/server";
import { apiUser, fail, isResponse, readJson } from "@/lib/api";
import { client } from "@/db";

export const dynamic = "force-dynamic";

const AUTO_HIDE_AFTER = 3; // distinct reporters before a card is hidden pending review

export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const body = await readJson<{ cardId?: number; deepDiveId?: number; reason?: string }>(req);
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
  const cardId = typeof body?.cardId === "number" ? body.cardId : null;
  const deepDiveId = typeof body?.deepDiveId === "number" ? body.deepDiveId : null;
  if (reason.length < 3 || (!cardId && !deepDiveId)) return fail("Say what's wrong");
  await client.execute({
    sql: "INSERT INTO reports (user_id, card_id, deep_dive_id, reason) VALUES (?, ?, ?, ?)",
    args: [user.id, cardId, deepDiveId, reason],
  });
  if (cardId) {
    const n = await client.execute({ sql: "SELECT COUNT(DISTINCT user_id) AS n FROM reports WHERE card_id = ? AND status = 'open'", args: [cardId] });
    if (Number((n.rows[0] as any).n) >= AUTO_HIDE_AFTER) {
      await client.execute({ sql: "UPDATE cards SET status = 'flagged' WHERE id = ?", args: [cardId] });
    }
  }
  return NextResponse.json({ ok: true });
}

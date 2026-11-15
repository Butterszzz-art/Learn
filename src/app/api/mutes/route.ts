import { NextResponse } from "next/server";
import { apiUser, fail, isResponse, readJson } from "@/lib/api";
import { MUTABLE_TYPES, dismissMuteNotice, resumeMuted } from "@/lib/mutes";

export const dynamic = "force-dynamic";

/** Resume a card type the feed stopped showing, or acknowledge the notice. */
export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const body = await readJson<{ interestId?: number; cardType?: string; action?: string }>(req);
  if (typeof body?.interestId !== "number" || !(MUTABLE_TYPES as readonly string[]).includes(body.cardType ?? "")) return fail("interestId and cardType are required");
  if (body.action === "resume") await resumeMuted(user.id, body.interestId, body.cardType!);
  else if (body.action === "dismiss") await dismissMuteNotice(user.id, body.interestId, body.cardType!);
  else return fail("action must be resume or dismiss");
  return NextResponse.json({ ok: true });
}

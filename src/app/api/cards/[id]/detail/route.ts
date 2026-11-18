import { NextResponse } from "next/server";
import { apiUser, fail, isResponse, logError } from "@/lib/api";
import { getBiteDetail } from "@/lib/engine/biteDetail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The in-depth length of a bite card, written on first request for older cards. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const cardId = Number(params.id);
  if (!Number.isInteger(cardId) || cardId <= 0) return fail("Bad card");
  try {
    const detail = await getBiteDetail(cardId);
    if (!detail) return fail("No in-depth version is available for this card", 404);
    return NextResponse.json({ detail });
  } catch (err) {
    await logError("bite_detail", err instanceof Error ? err.message : String(err), { cardId }, user.id);
    return fail("Couldn't write the in-depth version just now", 502);
  }
}

import { NextResponse } from "next/server";
import { apiUser, fail, isResponse, readJson } from "@/lib/api";
import { respondToCard, MIN_CROWD } from "@/lib/responses";

export const dynamic = "force-dynamic";

/** Records a guess or a side on an interactive card and returns what other readers said. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const cardId = Number(params.id);
  const body = await readJson<{ value?: number }>(req);
  const value = Number(body?.value);
  if (!Number.isInteger(cardId) || cardId <= 0 || !Number.isFinite(value)) return fail("Bad answer");
  const res = await respondToCard(user.id, cardId, value);
  if (!res) return fail("This card doesn't take answers", 404);
  // Hide the crowd until enough people have answered for it to mean something.
  return NextResponse.json({ crowd: res.crowd.responses >= MIN_CROWD ? res.crowd : null, responses: res.crowd.responses });
}

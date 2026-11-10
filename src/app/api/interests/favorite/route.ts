import { NextResponse } from "next/server";
import { apiUser, fail, isResponse, readJson } from "@/lib/api";
import { setIsFavorite } from "@/lib/interests";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const body = await readJson<{ interestId?: number; isFavorite?: boolean }>(req);
  if (typeof body?.interestId !== "number" || typeof body.isFavorite !== "boolean") return fail("interestId and isFavorite are required");
  await setIsFavorite(user.id, body.interestId, body.isFavorite);
  return NextResponse.json({ ok: true });
}

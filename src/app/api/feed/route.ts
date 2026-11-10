import { NextResponse } from "next/server";
import { apiUser, isResponse, readJson } from "@/lib/api";
import { getFeedPage } from "@/lib/feed";

export const dynamic = "force-dynamic";

// POST (not GET) because the list of card ids already on screen can be long.
export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const body = (await readJson(req)) ?? {};
  const page = await getFeedPage(user, {
    exclude: Array.isArray(body.exclude) ? body.exclude.map(Number) : [],
    excludeKeys: Array.isArray(body.excludeKeys) ? body.excludeKeys.map(String) : [],
    count: Number(body.count) || undefined,
    interestId: Number(body.interestId) || undefined,
  });
  return NextResponse.json(page);
}

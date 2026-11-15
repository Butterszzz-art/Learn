import { NextResponse } from "next/server";
import { apiUser, isResponse } from "@/lib/api";
import { searchIndex } from "@/lib/searchIndex";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q.trim().length < 2) return NextResponse.json({ results: [] });
  return NextResponse.json({ results: await searchIndex(q.slice(0, 120), user.id) });
}

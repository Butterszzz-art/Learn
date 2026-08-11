import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { searchIndex } from "@/lib/searchIndex";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await ensureDb();
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  try {
    const results = await searchIndex(q);
    return NextResponse.json({ results });
  } catch (err) {
    console.error("[api/search] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Search failed" }, { status: 500 });
  }
}

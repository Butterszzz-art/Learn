import { NextResponse } from "next/server";
import { client } from "@/db";
import { ensureDb } from "@/db/bootstrap";

export const dynamic = "force-dynamic";

/** Uptime check: confirms the app can reach its database. */
export async function GET() {
  try {
    await ensureDb();
    await client.execute("SELECT 1");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readJson } from "@/lib/api";
import { client } from "@/db";
import { ensureDb } from "@/db/bootstrap";

export const dynamic = "force-dynamic";

/** Browser-side errors, so they are visible on the admin page. */
export async function POST(req: Request) {
  await ensureDb();
  const user = await getCurrentUser();
  const body = await readJson<{ message?: string; detail?: string }>(req);
  if (typeof body?.message !== "string") return NextResponse.json({ ok: false });
  // Cap the volume one browser can write.
  const recent = await client.execute("SELECT COUNT(*) AS n FROM error_log WHERE source = 'client' AND created_at > datetime('now', '-1 minute')");
  if (Number((recent.rows[0] as any).n) < 30) {
    await client.execute({
      sql: "INSERT INTO error_log (user_id, source, message, detail) VALUES (?, 'client', ?, ?)",
      args: [user?.id ?? null, body.message.slice(0, 500), typeof body.detail === "string" ? body.detail.slice(0, 4000) : null],
    });
  }
  return NextResponse.json({ ok: true });
}

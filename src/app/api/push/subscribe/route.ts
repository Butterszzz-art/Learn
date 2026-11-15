import { NextResponse } from "next/server";
import { apiUser, fail, isResponse, readJson } from "@/lib/api";
import { pushEnabled, vapidPublicKey } from "@/lib/push";
import { client } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await apiUser();
  if (isResponse(user)) return user;
  if (!pushEnabled()) return fail("Notifications aren't configured on this server", 503);
  return NextResponse.json({ publicKey: vapidPublicKey() });
}

export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  if (!pushEnabled()) return fail("Notifications aren't configured on this server", 503);
  const body = await readJson<{ endpoint?: string; keys?: { p256dh?: string; auth?: string } }>(req);
  if (typeof body?.endpoint !== "string" || !/^https:\/\//.test(body.endpoint) || !body.keys?.p256dh || !body.keys?.auth) return fail("Invalid subscription");
  await client.execute({
    sql: `INSERT INTO push_subscriptions (endpoint, user_id, keys) VALUES (?, ?, ?)
          ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, keys = excluded.keys`,
    args: [body.endpoint, user.id, JSON.stringify({ p256dh: body.keys.p256dh, auth: body.keys.auth })],
  });
  return NextResponse.json({ ok: true });
}

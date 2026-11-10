import { NextResponse } from "next/server";
import { signUp } from "@/lib/auth";
import { clientIp, fail, readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson<{ email?: string; password?: string }>(req);
  if (typeof body?.email !== "string" || typeof body?.password !== "string") return fail("Email and password are required");
  const result = await signUp(body.email, body.password, clientIp(req));
  if (!result.ok) return fail(result.error, 400);
  return NextResponse.json({ ok: true });
}

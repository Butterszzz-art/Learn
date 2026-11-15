// Small helpers shared by API routes.
import { NextResponse } from "next/server";
import { getCurrentUser } from "./auth";
import type { CurrentUser } from "./auth";
import { client } from "@/db";

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** The signed-in user, or a 401 response to return as-is. */
export async function apiUser(): Promise<CurrentUser | NextResponse> {
  const user = await getCurrentUser();
  return user ?? fail("Not signed in", 401);
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0] : req.headers.get("x-real-ip") ?? "local").trim();
}

export async function readJson<T = any>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

/** Records a server-side failure where an admin can see it (the /admin page). */
export async function logError(source: string, message: string, detail?: unknown, userId?: number | null) {
  console.error(`[${source}] ${message}`, detail ?? "");
  try {
    await client.execute({
      sql: "INSERT INTO error_log (user_id, source, message, detail) VALUES (?, ?, ?, ?)",
      args: [userId ?? null, source, message.slice(0, 500), detail ? String(detail instanceof Error ? detail.stack ?? detail.message : detail).slice(0, 4000) : null],
    });
  } catch {}
}

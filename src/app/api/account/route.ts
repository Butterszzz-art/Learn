import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { deleteAccount, verifyPassword, SESSION_COOKIE } from "@/lib/auth";
import { apiUser, fail, isResponse, readJson } from "@/lib/api";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** Permanently deletes the signed-in account and everything private to it. */
export async function DELETE(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const body = await readJson<{ password?: string }>(req);
  const rows = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, user.id)).limit(1);
  if (!rows[0] || typeof body?.password !== "string" || !(await verifyPassword(body.password, rows[0].hash))) {
    return fail("Password is incorrect", 403);
  }
  await deleteAccount(user.id);
  cookies().delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}

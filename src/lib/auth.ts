// Accounts and sessions (Phase 12). Email + password, stored as scrypt
// hashes; sessions are random tokens kept in an httpOnly cookie and stored
// hashed in the database, so a leaked database can't be replayed as logins.
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db, client } from "@/db";
import { ensureDb } from "@/db/bootstrap";
import { users, sessions } from "@/db/schema";
import type { Plan, UserPrefs } from "@/db/schema";
import { getMeta, setMeta } from "@/db/migrateV2";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const SESSION_COOKIE = "neuron_session";
const SESSION_DAYS = 30;
const MAX_ATTEMPTS = 8; // per email+ip key, per 15 minutes
const ATTEMPT_WINDOW_MIN = 15;

export interface CurrentUser {
  id: number;
  email: string;
  displayName: string | null;
  plan: Plan;
  role: "user" | "admin";
  prefs: UserPrefs;
  onboarded: boolean;
  createdAt: string;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sqlTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export function validateCredentials(email: string, password: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return "Enter a valid email address.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 200) return "Password is too long.";
  return null;
}

/** True if this key (email or ip) has failed too often recently. */
async function tooManyAttempts(key: string): Promise<boolean> {
  const since = sqlTime(new Date(Date.now() - ATTEMPT_WINDOW_MIN * 60000));
  const res = await client.execute({
    sql: "SELECT COUNT(*) AS n FROM auth_attempts WHERE key = ? AND created_at > ?",
    args: [key, since],
  });
  return Number((res.rows[0] as any)?.n ?? 0) >= MAX_ATTEMPTS;
}

async function recordAttempt(key: string): Promise<void> {
  await client.execute({ sql: "INSERT INTO auth_attempts (key) VALUES (?)", args: [key] });
  // Opportunistic cleanup so the table never grows without bound.
  await client.execute({
    sql: "DELETE FROM auth_attempts WHERE created_at < ?",
    args: [sqlTime(new Date(Date.now() - 24 * 3600000))],
  });
}

async function startSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt: sqlTime(expires) });
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export type AuthResult = { ok: true; userId: number } | { ok: false; error: string };

export async function signUp(emailRaw: string, password: string, ip: string): Promise<AuthResult> {
  await ensureDb();
  const email = emailRaw.trim().toLowerCase();
  const invalid = validateCredentials(email, password);
  if (invalid) return { ok: false, error: invalid };
  if (await tooManyAttempts(`signup:${ip}`)) return { ok: false, error: "Too many attempts. Try again in a few minutes." };
  await recordAttempt(`signup:${ip}`);

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) return { ok: false, error: "An account with that email already exists. Sign in instead." };

  const countRes = await client.execute("SELECT COUNT(*) AS n FROM users");
  const isFirst = Number((countRes.rows[0] as any)?.n ?? 0) === 0;
  // The owner account: ADMIN_EMAIL if set, otherwise whoever signs up first.
  // It becomes admin and inherits whatever the app held before accounts.
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const isOwner = adminEmail ? email === adminEmail : isFirst;

  let userId: number;
  try {
    const inserted = await db
      .insert(users)
      .values({ email, passwordHash: await hashPassword(password), role: isOwner ? "admin" : "user", plan: isOwner ? "pro" : "free" })
      .returning({ id: users.id });
    userId = inserted[0].id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/unique constraint/i.test(message)) return { ok: false, error: "An account with that email already exists." };
    throw err;
  }

  if (isOwner) await claimLegacyData(userId);
  await startSession(userId);
  return { ok: true, userId };
}

export async function signIn(emailRaw: string, password: string, ip: string): Promise<AuthResult> {
  await ensureDb();
  const email = emailRaw.trim().toLowerCase();
  const key = `login:${email}:${ip}`;
  if (await tooManyAttempts(key)) return { ok: false, error: "Too many attempts. Try again in a few minutes." };

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  // Same message either way, so the form can't be used to discover accounts.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    await recordAttempt(key);
    return { ok: false, error: "Wrong email or password." };
  }
  await startSession(user.id);
  return { ok: true, userId: user.id };
}

export async function signOut(): Promise<void> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  cookies().delete(SESSION_COOKIE);
}

function parsePrefs(raw: string): UserPrefs {
  try {
    return JSON.parse(raw) as UserPrefs;
  } catch {
    return {};
  }
}

/** The signed-in user for this request, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  await ensureDb();
  const res = await client.execute({
    sql: `SELECT u.id, u.email, u.display_name, u.plan, u.role, u.prefs, u.onboarded_at, u.created_at, u.last_active_at
          FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ? AND s.expires_at > ?`,
    args: [hashToken(token), sqlTime(new Date())],
  });
  const r = res.rows[0] as any;
  if (!r) return null;
  // Touch last_active_at at most once an hour — it drives "active users"
  // counts and which (interest, level) pools get topped up.
  const hourAgo = sqlTime(new Date(Date.now() - 3600000));
  if (!r.last_active_at || r.last_active_at < hourAgo) {
    client
      .execute({ sql: "UPDATE users SET last_active_at = ? WHERE id = ?", args: [sqlTime(new Date()), r.id] })
      .catch(() => {});
  }
  return {
    id: Number(r.id),
    email: r.email,
    displayName: r.display_name,
    plan: r.plan as Plan,
    role: r.role,
    prefs: parsePrefs(r.prefs),
    onboarded: !!r.onboarded_at,
    createdAt: r.created_at,
  };
});

/** For pages: the signed-in user, or a redirect to /login. */
export async function requireUser(opts: { allowNotOnboarded?: boolean } = {}): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarded && !opts.allowNotOnboarded) redirect("/onboarding");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser({ allowNotOnboarded: true });
  if (user.role !== "admin") redirect("/");
  return user;
}

export async function updatePrefs(userId: number, patch: Partial<UserPrefs>): Promise<UserPrefs> {
  const rows = await db.select({ prefs: users.prefs }).from(users).where(eq(users.id, userId)).limit(1);
  const next = { ...parsePrefs(rows[0]?.prefs ?? "{}"), ...patch };
  await db.update(users).set({ prefs: JSON.stringify(next) }).where(eq(users.id, userId));
  return next;
}

export async function markOnboarded(userId: number): Promise<void> {
  await client.execute({
    sql: "UPDATE users SET onboarded_at = COALESCE(onboarded_at, current_timestamp) WHERE id = ?",
    args: [userId],
  });
}

/**
 * Hands the pre-accounts, single-user data to the owner account: interest
 * choices, settings, Library books, explain-it-back history, and the review
 * schedule. Runs once ever (guarded by schema_meta), copies rather than
 * moves, and leaves the old tables in place.
 */
export async function claimLegacyData(userId: number): Promise<void> {
  if (await getMeta(client, "legacy_owner")) return;
  await setMeta(client, "legacy_owner", String(userId));

  const hasLegacy = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_interests'");
  let claimedInterests = 0;
  if (hasLegacy.rows.length > 0) {
    const res = await client.execute({
      sql: `INSERT OR IGNORE INTO user_interest_prefs (user_id, interest_id, level, enabled, is_favorite)
            SELECT ?, ui.interest_id, ui.level, ui.enabled, i.is_favorite
            FROM user_interests ui JOIN interests i ON i.id = ui.interest_id`,
      args: [userId],
    });
    claimedInterests = res.rowsAffected;
  }
  const settingsRes = await client.execute("SELECT include_brain_games FROM settings WHERE id = 1").catch(() => null);
  const includeBrainGames = !!(settingsRes?.rows[0] as any)?.include_brain_games;
  await client.execute({
    sql: "UPDATE users SET prefs = ?, onboarded_at = CASE WHEN ? > 0 THEN current_timestamp ELSE onboarded_at END WHERE id = ?",
    args: [JSON.stringify({ includeBrainGames }), claimedInterests, userId],
  });
  await client.execute({ sql: "UPDATE books SET user_id = ? WHERE user_id IS NULL", args: [userId] });
  await client.execute({ sql: "UPDATE explain_backs SET user_id = ? WHERE user_id IS NULL", args: [userId] });
  await client.execute({ sql: "UPDATE search_index SET user_id = ? WHERE content_type IN ('chapter','explain_back') AND user_id IS NULL", args: [userId] });
}

export async function deleteAccount(userId: number): Promise<void> {
  // Private content first, then the account. Shared content (deep dives,
  // cards) is not owned by anyone and stays.
  const bookIds = (await client.execute({ sql: "SELECT id FROM books WHERE user_id = ?", args: [userId] })).rows.map(
    (r: any) => Number(r.id)
  );
  for (const bookId of bookIds) {
    await client.execute({ sql: "DELETE FROM explain_backs WHERE chapter_id IN (SELECT id FROM book_chapters WHERE book_id = ?)", args: [bookId] });
    await client.execute({ sql: "DELETE FROM drills WHERE source_chapter_id IN (SELECT id FROM book_chapters WHERE book_id = ?)", args: [bookId] });
    await client.execute({ sql: "DELETE FROM covered_topics WHERE chapter_id IN (SELECT id FROM book_chapters WHERE book_id = ?)", args: [bookId] });
    await client.execute({ sql: "DELETE FROM book_chapters WHERE book_id = ?", args: [bookId] });
  }
  const statements = [
    "DELETE FROM books WHERE user_id = ?",
    "DELETE FROM explain_backs WHERE user_id = ?",
    "DELETE FROM search_index WHERE user_id = ?",
    "DELETE FROM concepts WHERE owner_user_id = ?",
    "DELETE FROM user_interest_prefs WHERE user_id = ?",
    "DELETE FROM user_cards WHERE user_id = ?",
    "DELETE FROM user_concepts WHERE user_id = ?",
    "DELETE FROM push_subscriptions WHERE user_id = ?",
    "DELETE FROM reports WHERE user_id = ?",
    "DELETE FROM jobs WHERE user_id = ? AND status IN ('queued','failed')",
    "UPDATE ai_usage SET user_id = NULL WHERE user_id = ?",
    "DELETE FROM sessions WHERE user_id = ?",
    "DELETE FROM users WHERE id = ?",
  ];
  for (const sql of statements) await client.execute({ sql, args: [userId] });
}

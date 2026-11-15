// Web push (Phase 17). Standard Web Push with VAPID keys — works in the
// installed web app on Android, desktop, and iOS 16.4+ home-screen apps,
// with no third-party push service. Disabled (every function is a no-op)
// until VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are set; generate a pair with
// `npm run push:keys`.
import webpush from "web-push";
import { client } from "@/db";
import { countDue } from "./learning";

let configured: boolean | null = null;

export function pushEnabled(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return (configured = false);
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:support@example.com", pub, priv);
  return (configured = true);
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
}

/** Sends to every device a person has subscribed. Dead subscriptions are removed. */
export async function sendPush(userId: number, message: PushMessage): Promise<number> {
  if (!pushEnabled()) return 0;
  const subs = await client.execute({ sql: "SELECT endpoint, keys FROM push_subscriptions WHERE user_id = ?", args: [userId] });
  let sent = 0;
  for (const s of subs.rows as any[]) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys) }, JSON.stringify(message), { TTL: 6 * 3600 });
      sent++;
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await client.execute({ sql: "DELETE FROM push_subscriptions WHERE endpoint = ?", args: [s.endpoint] });
      }
    }
  }
  return sent;
}

/**
 * The one optional daily nudge. Goes only to people who picked an hour, at
 * most once per day, and only when there is something specific to say —
 * reviews that are due, or new cards since they last opened the app.
 */
export async function sendDailyNudges(): Promise<number> {
  if (!pushEnabled()) return 0;
  const hour = new Date().getUTCHours();
  const today = new Date().toISOString().slice(0, 10);
  const res = await client.execute({
    sql: `SELECT u.id, u.prefs, u.last_active_at FROM users u
          WHERE EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = u.id)
            AND json_extract(u.prefs, '$.notifyHour') = ?
            AND COALESCE(json_extract(u.prefs, '$.lastNudge'), '') != ?`,
    args: [hour, today],
  });
  let sent = 0;
  for (const u of res.rows as any[]) {
    const userId = Number(u.id);
    const due = await countDue(userId);
    const fresh = await client.execute({
      sql: `SELECT COUNT(*) AS n FROM cards c
            JOIN user_interest_prefs p ON p.interest_id = c.interest_id AND p.user_id = ? AND p.enabled = 1
            WHERE c.status = 'published' AND c.created_at > COALESCE(?, '1970-01-01')
              AND NOT EXISTS (SELECT 1 FROM user_cards uc WHERE uc.user_id = ? AND uc.card_id = c.id)`,
      args: [userId, u.last_active_at, userId],
    });
    const newCards = Number((fresh.rows[0] as any)?.n ?? 0);
    if (due === 0 && newCards === 0) continue;
    const message: PushMessage =
      due > 0
        ? { title: `${due} thing${due === 1 ? "" : "s"} to remember`, body: "A quick review keeps what you've learned from fading.", url: "/review" }
        : { title: "New in your feed", body: `${newCards} new card${newCards === 1 ? "" : "s"} in the fields you follow.`, url: "/" };
    if ((await sendPush(userId, message)) > 0) sent++;
    await client.execute({
      sql: "UPDATE users SET prefs = json_set(prefs, '$.lastNudge', ?) WHERE id = ?",
      args: [today, userId],
    });
  }
  return sent;
}

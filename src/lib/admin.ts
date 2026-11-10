// Numbers and queues for the admin page.
import { client } from "@/db";

async function scalar(sql: string, args: (string | number)[] = []): Promise<number> {
  const res = await client.execute({ sql, args });
  return Number((res.rows[0] as any)?.n ?? 0);
}

function sqlAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace("T", " ");
}

export interface AdminStats {
  users: number;
  active7d: number;
  proUsers: number;
  cards: number;
  deepDives: number;
  flaggedDives: number;
  concepts: number;
  jobsPending: number;
  jobsFailed7d: number;
  spendToday: number;
  spend7d: number;
  spend30d: number;
  costPerActiveUserDay: number | null;
  spendByPurpose: { purpose: string; model: string; calls: number; cost: number }[];
  cardsSeen7d: number;
  quizAccuracy7d: number | null;
}

export async function getAdminStats(): Promise<AdminStats> {
  const d1 = sqlAgo(1);
  const d7 = sqlAgo(7);
  const d30 = sqlAgo(30);
  const iso7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const [users, active7d, proUsers, cards, deepDives, flaggedDives, concepts, jobsPending, jobsFailed7d, cardsSeen7d] = await Promise.all([
    scalar("SELECT COUNT(*) AS n FROM users"),
    scalar("SELECT COUNT(*) AS n FROM users WHERE last_active_at >= ?", [d7]),
    scalar("SELECT COUNT(*) AS n FROM users WHERE plan = 'pro'"),
    scalar("SELECT COUNT(*) AS n FROM cards WHERE status = 'published'"),
    scalar("SELECT COUNT(*) AS n FROM deep_dives WHERE status = 'published'"),
    scalar("SELECT COUNT(*) AS n FROM deep_dives WHERE status = 'flagged'"),
    scalar("SELECT COUNT(*) AS n FROM concepts WHERE owner_user_id IS NULL"),
    scalar("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running')"),
    scalar("SELECT COUNT(*) AS n FROM jobs WHERE status = 'failed' AND created_at >= ?", [d7]),
    scalar("SELECT COUNT(*) AS n FROM user_cards WHERE seen_at >= ?", [iso7]),
  ]);
  const spend = async (since: string) => {
    const res = await client.execute({ sql: "SELECT COALESCE(SUM(cost_usd), 0) AS n FROM ai_usage WHERE created_at >= ?", args: [since] });
    return Number((res.rows[0] as any).n);
  };
  const [spendToday, spend7d, spend30d] = await Promise.all([spend(d1), spend(d7), spend(d30)]);
  // Person-days of activity in the last 7 days — the denominator for "cost per active user per day".
  const userDays = await scalar("SELECT COUNT(*) AS n FROM (SELECT DISTINCT user_id, substr(seen_at, 1, 10) FROM user_cards WHERE seen_at >= ?)", [iso7]);
  const purposeRes = await client.execute({
    sql: `SELECT purpose, model, COUNT(*) AS calls, SUM(cost_usd) AS cost FROM ai_usage
          WHERE created_at >= ? GROUP BY purpose, model ORDER BY cost DESC LIMIT 20`,
    args: [d7],
  });
  const acc = await client.execute({
    sql: `SELECT SUM(CASE WHEN answered_correct = 1 THEN 1 ELSE 0 END) AS c, COUNT(*) AS t
          FROM user_cards WHERE answered_correct IS NOT NULL AND seen_at >= ?`,
    args: [iso7],
  });
  const total = Number((acc.rows[0] as any)?.t ?? 0);
  return {
    users,
    active7d,
    proUsers,
    cards,
    deepDives,
    flaggedDives,
    concepts,
    jobsPending,
    jobsFailed7d,
    spendToday,
    spend7d,
    spend30d,
    costPerActiveUserDay: userDays > 0 ? spend7d / userDays : null,
    spendByPurpose: (purposeRes.rows as any[]).map((r) => ({ purpose: r.purpose, model: r.model, calls: Number(r.calls), cost: Number(r.cost) })),
    cardsSeen7d,
    quizAccuracy7d: total > 0 ? Number((acc.rows[0] as any).c) / total : null,
  };
}

export interface FlaggedDive {
  id: number;
  topic: string;
  interestName: string;
  level: string;
  qualityScore: number | null;
  qualityNotes: string | null;
  createdAt: string;
}

export async function getFlaggedDives(): Promise<FlaggedDive[]> {
  const res = await client.execute(
    `SELECT d.id, d.topic, d.level, d.quality_score, d.quality_notes, d.created_at, i.name AS interest_name
     FROM deep_dives d JOIN interests i ON i.id = d.interest_id WHERE d.status = 'flagged' ORDER BY d.id DESC LIMIT 50`
  );
  return (res.rows as any[]).map((r) => ({
    id: Number(r.id),
    topic: r.topic,
    interestName: r.interest_name,
    level: r.level,
    qualityScore: r.quality_score === null ? null : Number(r.quality_score),
    qualityNotes: r.quality_notes,
    createdAt: r.created_at,
  }));
}

export interface OpenReport {
  id: number;
  reason: string;
  createdAt: string;
  cardId: number | null;
  deepDiveId: number | null;
  title: string | null;
  cardStatus: string | null;
}

export async function getOpenReports(): Promise<OpenReport[]> {
  const res = await client.execute(
    `SELECT r.id, r.reason, r.created_at, r.card_id, r.deep_dive_id, COALESCE(c.title, d.topic) AS title, c.status AS card_status
     FROM reports r LEFT JOIN cards c ON c.id = r.card_id LEFT JOIN deep_dives d ON d.id = r.deep_dive_id
     WHERE r.status = 'open' ORDER BY r.id DESC LIMIT 100`
  );
  return (res.rows as any[]).map((r) => ({
    id: Number(r.id),
    reason: r.reason,
    createdAt: r.created_at,
    cardId: r.card_id === null ? null : Number(r.card_id),
    deepDiveId: r.deep_dive_id === null ? null : Number(r.deep_dive_id),
    title: r.title,
    cardStatus: r.card_status,
  }));
}

export async function getRecentErrors(limit = 30) {
  const res = await client.execute({ sql: "SELECT id, source, message, detail, created_at FROM error_log ORDER BY id DESC LIMIT ?", args: [limit] });
  return (res.rows as any[]).map((r) => ({ id: Number(r.id), source: r.source as string, message: r.message as string, detail: r.detail as string | null, createdAt: r.created_at as string }));
}

export type AdminAction =
  | { type: "publish_dive"; id: number }
  | { type: "flag_dive"; id: number }
  | { type: "resolve_report"; id: number }
  | { type: "hide_card"; id: number }
  | { type: "restore_card"; id: number }
  | { type: "set_plan"; email: string; plan: "free" | "pro" }
  | { type: "retry_failed_jobs" };

export async function runAdminAction(a: AdminAction): Promise<string> {
  switch (a.type) {
    case "publish_dive":
      await client.execute({ sql: "UPDATE deep_dives SET status = 'published' WHERE id = ?", args: [a.id] });
      await client.execute({ sql: "UPDATE cards SET status = 'published' WHERE deep_dive_id = ?", args: [a.id] });
      return "Published.";
    case "flag_dive":
      await client.execute({ sql: "UPDATE deep_dives SET status = 'flagged' WHERE id = ?", args: [a.id] });
      await client.execute({ sql: "UPDATE cards SET status = 'flagged' WHERE deep_dive_id = ?", args: [a.id] });
      await client.execute({ sql: "DELETE FROM search_index WHERE dedupe_key = ?", args: [`deep_dive:${a.id}`] });
      return "Unpublished.";
    case "resolve_report":
      await client.execute({ sql: "UPDATE reports SET status = 'resolved' WHERE id = ?", args: [a.id] });
      return "Resolved.";
    case "hide_card":
      await client.execute({ sql: "UPDATE cards SET status = 'flagged' WHERE id = ?", args: [a.id] });
      await client.execute({ sql: "UPDATE reports SET status = 'resolved' WHERE card_id = ?", args: [a.id] });
      return "Card hidden and its reports resolved.";
    case "restore_card":
      await client.execute({ sql: "UPDATE cards SET status = 'published' WHERE id = ?", args: [a.id] });
      await client.execute({ sql: "UPDATE reports SET status = 'resolved' WHERE card_id = ?", args: [a.id] });
      return "Card restored and its reports resolved.";
    case "set_plan": {
      const res = await client.execute({ sql: "UPDATE users SET plan = ? WHERE email = ?", args: [a.plan, a.email.trim().toLowerCase()] });
      return res.rowsAffected > 0 ? `Plan set to ${a.plan}.` : "No account with that email.";
    }
    case "retry_failed_jobs": {
      const res = await client.execute("UPDATE jobs SET status = 'queued', attempts = 0, run_after = NULL, error = NULL WHERE status = 'failed'");
      return `${res.rowsAffected} job(s) re-queued.`;
    }
  }
}

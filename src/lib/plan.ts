// What each plan includes, and the counters that enforce it. Everything
// that can spend AI budget on one person's behalf is capped per day so a
// single account can never run up the bill.
import { client } from "@/db";
import type { Plan } from "@/db/schema";

export interface PlanLimits {
  label: string;
  onDemandDivesPerDay: number; // follow-ups / "pick my next topic"
  asksPerDay: number; // "ask about this card"
  explainBacksPerDay: number;
  customInterests: number;
  libraryBooks: number;
  researchLevel: boolean;
  exportAll: boolean;
  dailyAiUsd: number; // hard ceiling on AI spend attributed to this person
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    label: "Free",
    onDemandDivesPerDay: 2,
    asksPerDay: 10,
    explainBacksPerDay: 5,
    customInterests: 1,
    libraryBooks: 1,
    researchLevel: false,
    exportAll: false,
    dailyAiUsd: 0.15,
  },
  pro: {
    label: "Pro",
    onDemandDivesPerDay: 20,
    asksPerDay: 200,
    explainBacksPerDay: 50,
    customInterests: 20,
    libraryBooks: 50,
    researchLevel: true,
    exportAll: true,
    dailyAiUsd: 3,
  },
};

export type QuotaKind = "onDemandDive" | "ask" | "explainBack" | "customInterest" | "libraryBook";

export interface QuotaCheck {
  ok: boolean;
  used: number;
  limit: number;
  message: string;
}

function dayStartSql(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

async function count(sql: string, args: (string | number)[]): Promise<number> {
  const res = await client.execute({ sql, args });
  return Number((res.rows[0] as any)?.n ?? 0);
}

export async function aiSpendToday(userId: number): Promise<number> {
  const res = await client.execute({
    sql: "SELECT COALESCE(SUM(cost_usd), 0) AS n FROM ai_usage WHERE user_id = ? AND created_at >= ?",
    args: [userId, dayStartSql()],
  });
  return Number((res.rows[0] as any)?.n ?? 0);
}

const UPGRADE_HINT: Record<QuotaKind, string> = {
  onDemandDive: "on-demand deep dives today",
  ask: "questions today",
  explainBack: "explain-it-back reviews today",
  customInterest: "custom interests",
  libraryBook: "Library uploads",
};

export async function checkQuota(userId: number, plan: Plan, kind: QuotaKind): Promise<QuotaCheck> {
  const limits = PLAN_LIMITS[plan];
  const since = dayStartSql();
  let used = 0;
  let limit = 0;
  switch (kind) {
    case "onDemandDive":
      limit = limits.onDemandDivesPerDay;
      used = await count("SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND type = 'topic_dive' AND created_at >= ?", [userId, since]);
      break;
    case "ask":
      limit = limits.asksPerDay;
      used = await count("SELECT COUNT(*) AS n FROM ai_usage WHERE user_id = ? AND purpose = 'ask' AND created_at >= ?", [userId, since]);
      break;
    case "explainBack":
      limit = limits.explainBacksPerDay;
      used = await count("SELECT COUNT(*) AS n FROM explain_backs WHERE user_id = ? AND created_at >= ?", [userId, since]);
      break;
    case "customInterest":
      limit = limits.customInterests;
      used = await count(
        `SELECT COUNT(*) AS n FROM user_interest_prefs p JOIN interests i ON i.id = p.interest_id
         WHERE p.user_id = ? AND i.is_custom = 1 AND p.enabled = 1`,
        [userId]
      );
      break;
    case "libraryBook":
      limit = limits.libraryBooks;
      used = await count("SELECT COUNT(*) AS n FROM books WHERE user_id = ?", [userId]);
      break;
  }
  if (used >= limit) {
    return {
      ok: false,
      used,
      limit,
      message:
        plan === "free"
          ? `You've used your ${limit} free ${UPGRADE_HINT[kind]}. Neuron Pro raises this limit.`
          : `You've reached the limit of ${limit} ${UPGRADE_HINT[kind]}.`,
    };
  }
  // The dollar ceiling backs up the per-feature counters.
  if (kind !== "customInterest" && kind !== "libraryBook" && (await aiSpendToday(userId)) >= limits.dailyAiUsd) {
    return { ok: false, used, limit, message: "You've reached today's usage limit. It resets at midnight UTC." };
  }
  return { ok: true, used, limit, message: "" };
}

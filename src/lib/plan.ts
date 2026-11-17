// What each plan includes, and the counters that enforce it. Everything
// that can spend AI budget on one person's behalf is capped per day so a
// single account can never run up the bill.
//
// Cost model (see routeForCurrentCall in ai.ts): the shared feed is written
// once on the paid model for everyone. A free account's personal requests
// (asks, explain-backs, Library, syllabi) run on free models, so the only
// paid spend a free account can cause is its on-demand deep dives, which are
// kept to one a day. Custom fields are Pro-only because each one makes the
// paid model write a whole series for a single reader.
import { client } from "@/db";
import type { Plan } from "@/db/schema";

export interface PlanLimits {
  label: string;
  onDemandDivesPerDay: number; // follow-ups / "pick my next topic"
  asksPerDay: number; // "ask about this card"
  explainBacksPerDay: number;
  customInterests: number;
  libraryBooks: number;
  syllabi: number;
  researchQuestionsPerDay: number; // Research tab
  researchLevel: boolean;
  exportAll: boolean;
  dailyAiUsd: number; // hard ceiling on AI spend attributed to this person
  monthlyAiUsd: number; // keeps one heavy month under the plan's price
  paidModels: boolean; // personal requests use the paid model (else free models)
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    label: "Free",
    onDemandDivesPerDay: 1,
    asksPerDay: 3,
    explainBacksPerDay: 2,
    customInterests: 0,
    libraryBooks: 1,
    syllabi: 1,
    researchQuestionsPerDay: 2,
    researchLevel: false,
    exportAll: false,
    dailyAiUsd: 0.15,
    monthlyAiUsd: 1,
    paidModels: false,
  },
  pro: {
    label: "Pro",
    onDemandDivesPerDay: 25,
    asksPerDay: 300,
    explainBacksPerDay: 100,
    customInterests: 20,
    libraryBooks: 50,
    syllabi: 20,
    researchQuestionsPerDay: 100,
    researchLevel: true,
    exportAll: true,
    dailyAiUsd: 2,
    monthlyAiUsd: 6,
    paidModels: true,
  },
};

export type QuotaKind = "onDemandDive" | "ask" | "explainBack" | "customInterest" | "libraryBook" | "syllabus" | "research";

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

function monthStartSql(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

async function aiSpendSince(userId: number, since: string): Promise<number> {
  const res = await client.execute({
    sql: "SELECT COALESCE(SUM(cost_usd), 0) AS n FROM ai_usage WHERE user_id = ? AND created_at >= ?",
    args: [userId, since],
  });
  return Number((res.rows[0] as any)?.n ?? 0);
}

export function aiSpendToday(userId: number): Promise<number> {
  return aiSpendSince(userId, dayStartSql());
}

export function aiSpendThisMonth(userId: number): Promise<number> {
  return aiSpendSince(userId, monthStartSql());
}

const UPGRADE_HINT: Record<QuotaKind, string> = {
  onDemandDive: "on-demand deep dives today",
  ask: "questions today",
  explainBack: "explain-it-back reviews today",
  customInterest: "custom interests",
  libraryBook: "Library uploads",
  syllabus: "attached syllabi",
  research: "research questions today",
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
    case "syllabus":
      limit = limits.syllabi;
      used = await count("SELECT COUNT(*) AS n FROM syllabi WHERE user_id = ?", [userId]);
      break;
    case "research":
      limit = limits.researchQuestionsPerDay;
      used = await count("SELECT COUNT(*) AS n FROM ai_usage WHERE user_id = ? AND purpose = 'research' AND created_at >= ?", [userId, since]);
      break;
    case "libraryBook":
      limit = limits.libraryBooks;
      used = await count("SELECT COUNT(*) AS n FROM books WHERE user_id = ?", [userId]);
      break;
  }
  if (limit === 0) {
    return { ok: false, used, limit, message: `${UPGRADE_HINT[kind][0].toUpperCase()}${UPGRADE_HINT[kind].slice(1)} are part of Neuron Pro.` };
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
  if (kind !== "customInterest" && kind !== "libraryBook" && kind !== "syllabus" && kind !== "research") {
    if ((await aiSpendToday(userId)) >= limits.dailyAiUsd) {
      return { ok: false, used, limit, message: "You've reached today's usage limit. It resets at midnight UTC." };
    }
    if ((await aiSpendThisMonth(userId)) >= limits.monthlyAiUsd) {
      return { ok: false, used, limit, message: "You've reached this month's usage limit. It resets on the 1st (UTC)." };
    }
  }
  return { ok: true, used, limit, message: "" };
}

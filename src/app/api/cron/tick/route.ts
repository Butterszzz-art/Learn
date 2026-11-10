import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { planWork } from "@/lib/engine/scheduler";
import { drain, pendingJobCount } from "@/lib/engine/jobs";
import { sendDailyNudges } from "@/lib/push";
import { fail, logError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The scheduled heartbeat: decides what the shared pool needs, then works
 * through the queue for as long as the function is allowed to run.
 * Protected by CRON_SECRET (Vercel Cron sends it as a Bearer token).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return fail("CRON_SECRET is not configured", 503);
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return fail("Unauthorized", 401);
  await ensureDb();
  try {
    const planned = await planWork();
    const budget = Number(new URL(req.url).searchParams.get("budgetMs")) || 240_000;
    const ran = await drain(Math.min(budget, 280_000));
    const nudges = await sendDailyNudges().catch(() => 0);
    return NextResponse.json({ planned, ran, nudges, pending: await pendingJobCount() });
  } catch (err) {
    await logError("cron", "tick failed", err);
    return fail("tick failed", 500);
  }
}

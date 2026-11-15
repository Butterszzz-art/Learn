import { NextResponse } from "next/server";
import { apiUser, fail, isResponse, readJson } from "@/lib/api";
import { runAdminAction } from "@/lib/admin";
import type { AdminAction } from "@/lib/admin";
import { planWork } from "@/lib/engine/scheduler";
import { drain } from "@/lib/engine/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TYPES = ["publish_dive", "flag_dive", "resolve_report", "hide_card", "restore_card", "set_plan", "retry_failed_jobs", "run_tick"];

export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  if (user.role !== "admin") return fail("Admins only", 403);
  const body = await readJson<any>(req);
  if (!body || !TYPES.includes(body.type)) return fail("Unknown action");
  if (body.type === "run_tick") {
    const planned = await planWork();
    const ran = await drain(50_000);
    return NextResponse.json({ message: `Queued ${planned.series} series, ${planned.news} news, ${planned.expand} expansions; ran ${ran} job(s).` });
  }
  if (["publish_dive", "flag_dive", "resolve_report", "hide_card", "restore_card"].includes(body.type) && !Number.isInteger(body.id)) return fail("id is required");
  if (body.type === "set_plan" && (typeof body.email !== "string" || !["free", "pro"].includes(body.plan))) return fail("email and plan are required");
  return NextResponse.json({ message: await runAdminAction(body as AdminAction) });
}

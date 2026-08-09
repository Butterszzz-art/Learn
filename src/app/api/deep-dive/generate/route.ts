import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { generateOnDemandDeepDive } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
// Same reasoning as /api/refresh/deep-dive: web_search + long-form writing
// is the slowest generation this app does. Unlike that route, a retry here
// is NOT a safe no-op (it generates another dive, not a duplicate-preventing
// no-op) — the UI disables the triggering button while a request is in
// flight rather than relying on idempotent retry safety.
export const maxDuration = 300;

export async function POST(req: Request) {
  await ensureDb();
  const body = await req.json().catch(() => null);
  const interestId = Number(body?.interestId);
  const forcedTopic = typeof body?.forcedTopic === "string" && body.forcedTopic.trim() ? body.forcedTopic.trim() : undefined;
  if (!Number.isFinite(interestId)) {
    return NextResponse.json({ error: "interestId is required" }, { status: 400 });
  }

  try {
    const result = await generateOnDemandDeepDive(interestId, forcedTopic);
    if (!result) {
      return NextResponse.json({ error: "Interest not found or not enabled" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/deep-dive/generate] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Deep dive generation failed" },
      { status: 500 }
    );
  }
}

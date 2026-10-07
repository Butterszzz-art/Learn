import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { listFallbackItems, upgradeSummary } from "@/lib/summaryUpgrade";

export const dynamic = "force-dynamic";
// Each call works through as many items as fit in ~40s and reports where it
// stopped, so the client can keep calling until the backlog is cleared — the
// summary provider's free-tier rate limit makes one big call impossible.
export const maxDuration = 60;
const BUDGET_MS = 40_000;

/**
 * Body: { skip?: number }. `skip` is how many still-unupgradeable items (no
 * usable source text, or a failed attempt) the client has already stepped
 * past, so those don't block the items behind them on the next call.
 * Response: { upgraded, nextSkip, remaining, outOfTime, done }.
 */
export async function POST(req: Request) {
  await ensureDb();
  const body = await req.json().catch(() => null);
  const skip = Math.max(0, Number(body?.skip) || 0);

  try {
    const deadline = Date.now() + BUDGET_MS;
    const rows = await listFallbackItems();
    let i = skip;
    let upgraded = 0;
    let outOfTime = false;
    while (i < rows.length) {
      if (Date.now() > deadline - 8_000) {
        outOfTime = true;
        break;
      }
      const result = await upgradeSummary(rows[i], { deadline });
      if (result.status === "out-of-time") {
        outOfTime = true;
        break;
      }
      if (result.status === "upgraded") {
        upgraded++;
        // An upgraded row drops out of the list, so the offset stays put.
        rows.splice(i, 1);
      } else {
        i++;
      }
    }
    return NextResponse.json({
      upgraded,
      nextSkip: i,
      remaining: rows.length - i,
      outOfTime,
      done: !outOfTime && i >= rows.length,
    });
  } catch (err) {
    console.error("[api/refresh/summaries] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Summary upgrade failed" },
      { status: 500 }
    );
  }
}

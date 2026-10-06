import { NextResponse } from "next/server";
import { hasOpenRouterKey, runResearchAgent } from "@/lib/researchAgent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!hasOpenRouterKey()) {
    return NextResponse.json(
      { error: "Research Agent isn't configured — set OPENROUTER_API_KEY in .env.local and restart." },
      { status: 501 }
    );
  }

  const body = await req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) {
    return NextResponse.json({ error: "A question is required." }, { status: 400 });
  }

  try {
    const result = await runResearchAgent(question);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/research] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Research Agent failed" },
      { status: 500 }
    );
  }
}

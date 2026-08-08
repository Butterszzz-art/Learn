import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { createCustomInterest } from "@/lib/interests";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await ensureDb();
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (name.length > 80) {
    return NextResponse.json({ error: "name is too long (max 80 chars)" }, { status: 400 });
  }

  const generatesAppliedInsights =
    typeof body?.generatesAppliedInsights === "boolean" ? body.generatesAppliedInsights : true;

  try {
    const interest = await createCustomInterest(name, generatesAppliedInsights);
    return NextResponse.json(interest);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create interest" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { getSyllabiForInterest, createSyllabus } from "@/lib/syllabus";

export const dynamic = "force-dynamic";
// Parsing a syllabus is one Claude call over pasted text — comfortably
// within a normal serverless request, unlike the multi-step Library upload
// flow (no PDF document processing here, just plain text).
export const maxDuration = 60;

export async function GET(req: Request) {
  await ensureDb();
  const interestId = Number(new URL(req.url).searchParams.get("interestId"));
  if (!Number.isFinite(interestId)) {
    return NextResponse.json({ error: "interestId query param is required" }, { status: 400 });
  }
  return NextResponse.json(await getSyllabiForInterest(interestId));
}

export async function POST(req: Request) {
  await ensureDb();
  const body = await req.json().catch(() => null);
  const interestId = Number(body?.interestId);
  const name = typeof body?.name === "string" ? body.name : "";
  const rawContent = typeof body?.rawContent === "string" ? body.rawContent : "";

  if (!Number.isFinite(interestId) || !rawContent.trim()) {
    return NextResponse.json({ error: "interestId and rawContent are required" }, { status: 400 });
  }

  try {
    const syllabus = await createSyllabus(interestId, name, rawContent);
    return NextResponse.json(syllabus);
  } catch (err) {
    console.error("[api/syllabi] Create failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't parse this syllabus" }, { status: 500 });
  }
}

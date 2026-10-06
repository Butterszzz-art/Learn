import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { deleteSyllabus } from "@/lib/syllabus";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  await ensureDb();
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  await deleteSyllabus(id);
  return NextResponse.json({ ok: true });
}

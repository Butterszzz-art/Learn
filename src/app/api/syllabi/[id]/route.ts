import { NextResponse } from "next/server";
import { apiUser, fail, isResponse } from "@/lib/api";
import { deleteSyllabus } from "@/lib/syllabus";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const id = Number(params.id);
  if (!Number.isFinite(id)) return fail("Invalid id");
  await deleteSyllabus(id, user.id);
  return NextResponse.json({ ok: true });
}

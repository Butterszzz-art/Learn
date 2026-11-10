import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { getPublicCard } from "@/lib/publicCard";

export const dynamic = "force-dynamic";

/** Public JSON for one shareable card (shared-pool content only). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  await ensureDb();
  const card = await getPublicCard(Number(params.id));
  if (!card) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(card, { headers: { "Cache-Control": "public, max-age=600" } });
}

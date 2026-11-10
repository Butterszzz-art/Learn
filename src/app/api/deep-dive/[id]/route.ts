import { NextResponse } from "next/server";
import { apiUser, fail, isResponse } from "@/lib/api";
import { getDeepDiveDetail, markDeepDiveOpened } from "@/lib/content";

export const dynamic = "force-dynamic";

/** The full entry behind a card, for the "Go deeper" sheet. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const id = Number(params.id);
  if (!Number.isFinite(id)) return fail("Invalid id");
  const detail = await getDeepDiveDetail(id, user.id);
  if (!detail || (detail.status === "flagged" && user.role !== "admin")) return fail("Not found", 404);
  await markDeepDiveOpened(id, user.id);
  return NextResponse.json({
    id: detail.id,
    topic: detail.topic,
    content: detail.content,
    interestName: detail.interestName,
    takeaways: detail.takeaways,
    sources: detail.sources,
  });
}

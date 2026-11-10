import { NextResponse } from "next/server";
import { apiUser, fail, isResponse } from "@/lib/api";
import { getJob } from "@/lib/engine/jobs";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const job = await getJob(Number(params.id));
  if (!job || (job.userId !== null && job.userId !== user.id && user.role !== "admin")) return fail("Not found", 404);
  return NextResponse.json({
    status: job.status,
    deepDiveId: job.result?.deepDiveId ?? null,
    flagged: !!job.result?.flagged,
    error: job.status === "failed" ? "This one couldn't be generated. Try again in a bit." : null,
  });
}

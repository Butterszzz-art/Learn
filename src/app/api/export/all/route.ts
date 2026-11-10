import { NextResponse } from "next/server";
import { apiUser, fail, isResponse } from "@/lib/api";
import { generateFullExportZip } from "@/lib/export";
import { PLAN_LIMITS } from "@/lib/plan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const user = await apiUser();
  if (isResponse(user)) return user;
  if (!PLAN_LIMITS[user.plan].exportAll) return fail("Exporting everything at once is part of Neuron Pro. Single entries export from their own page.", 402);
  const zip = await generateFullExportZip(user.id);
  return new NextResponse(zip as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="neuron-export-${new Date().toISOString().slice(0, 10)}.zip"`,
    },
  });
}

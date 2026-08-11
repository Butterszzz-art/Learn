import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { generateFullExportZip } from "@/lib/export";

export const dynamic = "force-dynamic";
// Bulk export touches every Deep Dive and Library chapter in the DB —
// still comfortably fast at this app's personal-scale data volumes (no
// Claude calls involved, just DB reads + markdown/zip assembly), but
// give it Pro's longer cap rather than Hobby's 60s in case an account has
// accumulated a lot of content over many cycles.
export const maxDuration = 300;

export async function GET() {
  await ensureDb();
  try {
    const zip = await generateFullExportZip();
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(zip as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="neuron-export-${date}.zip"`,
      },
    });
  } catch (err) {
    console.error("[api/export/all] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Export failed" }, { status: 500 });
  }
}

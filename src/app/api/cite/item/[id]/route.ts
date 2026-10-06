import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { getItemCitationEntry, citeKeyFor, toBibTeX, toRIS } from "@/lib/citations";
import { slugify } from "@/lib/export";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  await ensureDb();
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const entry = await getItemCitationEntry(id);
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const format = new URL(req.url).searchParams.get("format") === "ris" ? "ris" : "bib";
  const filename = `${slugify(entry.title)}.${format === "ris" ? "ris" : "bib"}`;
  const body = format === "ris" ? toRIS(entry) : toBibTeX(entry, citeKeyFor(entry));

  return new NextResponse(body, {
    headers: {
      "Content-Type": format === "ris" ? "application/x-research-info-systems; charset=utf-8" : "application/x-bibtex; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

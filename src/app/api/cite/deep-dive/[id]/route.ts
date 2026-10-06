import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { getDeepDiveSourceCitations, bulkBibTeX, bulkRIS } from "@/lib/citations";
import { slugify } from "@/lib/export";

export const dynamic = "force-dynamic";

/** Exports every source a Deep Dive draws from as one bulk BibTeX/RIS file —
 * a dive itself isn't a single citable work, but its sources are. 404 if
 * the dive doesn't exist; an empty (but 200) file if it exists but has no
 * sources (a synthesized entry — nothing to export, not an error). */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  await ensureDb();
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const result = await getDeepDiveSourceCitations(id);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const format = new URL(req.url).searchParams.get("format") === "ris" ? "ris" : "bib";
  const filename = `${slugify(result.topic)}-sources.${format === "ris" ? "ris" : "bib"}`;
  const body = format === "ris" ? bulkRIS(result.entries) : bulkBibTeX(result.entries);

  return new NextResponse(body, {
    headers: {
      "Content-Type": format === "ris" ? "application/x-research-info-systems; charset=utf-8" : "application/x-bibtex; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

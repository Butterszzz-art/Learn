import { NextResponse } from "next/server";
import { apiUser, fail, isResponse } from "@/lib/api";
import { getDeepDiveSourceCitations, bulkBibTeX, bulkRIS } from "@/lib/citations";
import { slugify } from "@/lib/export";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const id = Number(params.id);
  if (!Number.isFinite(id)) return fail("Invalid id");
  const found = await getDeepDiveSourceCitations(id);
  if (!found || found.entries.length === 0) return fail("Not found", 404);
  const format = new URL(req.url).searchParams.get("format") === "ris" ? "ris" : "bib";
  const filename = `${slugify(`${found.topic}-sources`)}.${format}`;
  const body = format === "ris" ? bulkRIS(found.entries) : bulkBibTeX(found.entries);
  return new NextResponse(body, {
    headers: {
      "Content-Type": format === "ris" ? "application/x-research-info-systems; charset=utf-8" : "application/x-bibtex; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

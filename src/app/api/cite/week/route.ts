import { NextResponse } from "next/server";
import { ensureDb } from "@/db/bootstrap";
import { getWeekCitationEntries, bulkBibTeX, bulkRIS } from "@/lib/citations";

export const dynamic = "force-dynamic";

/** Bulk "export this week's sources as BibTeX/RIS" — every News item across
 * the current weekly cycle, dropped straight into Zotero/Mendeley. */
export async function GET(req: Request) {
  await ensureDb();
  const entries = await getWeekCitationEntries();
  const format = new URL(req.url).searchParams.get("format") === "ris" ? "ris" : "bib";
  const body = format === "ris" ? bulkRIS(entries) : bulkBibTeX(entries);
  const dateStamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(body, {
    headers: {
      "Content-Type": format === "ris" ? "application/x-research-info-systems; charset=utf-8" : "application/x-bibtex; charset=utf-8",
      "Content-Disposition": `attachment; filename="neuron-sources-${dateStamp}.${format === "ris" ? "ris" : "bib"}"`,
    },
  });
}

import { NextResponse } from "next/server";
import { apiUser, isResponse } from "@/lib/api";
import { getWeekCitationEntries, bulkBibTeX, bulkRIS } from "@/lib/citations";

export const dynamic = "force-dynamic";

/** Citations for every research item you were shown in the last seven days. */
export async function GET(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const entries = await getWeekCitationEntries(user.id);
  const format = new URL(req.url).searchParams.get("format") === "ris" ? "ris" : "bib";
  const body = format === "ris" ? bulkRIS(entries) : bulkBibTeX(entries);
  return new NextResponse(body, {
    headers: {
      "Content-Type": format === "ris" ? "application/x-research-info-systems; charset=utf-8" : "application/x-bibtex; charset=utf-8",
      "Content-Disposition": `attachment; filename="neuron-sources-${new Date().toISOString().slice(0, 10)}.${format}"`,
    },
  });
}

// One-off backfill: re-summarize items still carrying the truncated fallback
// summary (raw snippet cut at ~300 chars, ending in "…") using the current
// summary provider and length target. Only items whose stored raw abstract is
// substantial enough to support a long summary are touched.
//
// Usage: npm run resummarize            (all eligible items)
//        npm run resummarize -- --dry   (print what would change, write nothing)
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { ensureDb } from "../src/db/bootstrap";
import { db } from "../src/db";
import { items } from "../src/db/schema";
import { eq, like, and, isNotNull } from "drizzle-orm";
import { summarizeBatch } from "../src/lib/claude";
import { hasSummaryLlm, inventedNumbers } from "../src/lib/summaryLlm";
import type { RawItem } from "../src/lib/types";

const MIN_SOURCE_CHARS = 600;

async function main() {
  const dry = process.argv.includes("--dry");
  if (!hasSummaryLlm()) {
    console.error("SUMMARY_LLM_API_KEY is not set — refusing to run (the Anthropic path may be out of credit).");
    process.exit(1);
  }
  await ensureDb();

  const rows = await db
    .select()
    .from(items)
    .where(and(like(items.summary, "%…"), isNotNull(items.rawSnippet)));
  const eligible = rows.filter((r) => (r.rawSnippet ?? "").length >= MIN_SOURCE_CHARS);
  console.log(`${rows.length} fallback-summary items, ${eligible.length} with a long enough source abstract.`);

  const raw: RawItem[] = eligible.map((r) => ({
    title: r.title,
    authors: r.authors ?? undefined,
    snippet: r.rawSnippet ?? "",
    url: r.url,
    publishedAt: r.publishedAt ?? undefined,
    sourceName: r.sourceName,
    sourceType: r.sourceType,
  }));

  const results = await summarizeBatch(raw);
  let updated = 0;
  for (let i = 0; i < eligible.length; i++) {
    const summary = results.get(i);
    const words = summary ? summary.trim().split(/\s+/).length : 0;
    const invented = summary ? inventedNumbers(summary, eligible[i].title + " " + (eligible[i].rawSnippet ?? "")) : [];
    console.log(`[${i + 1}/${eligible.length}] ${eligible[i].title.slice(0, 70)} — ${summary ? words + " words" : "FAILED (kept old)"}${invented.length ? "  NUMBERS NOT IN SOURCE: " + invented.join(", ") : ""}`);
    if (!summary || dry) continue;
    await db.update(items).set({ summary }).where(eq(items.id, eligible[i].id));
    updated++;
  }
  console.log(dry ? "Dry run — nothing written." : `Updated ${updated}/${eligible.length}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

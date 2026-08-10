import type { RawItem } from "../types";
import { fetchRssFeed } from "./rss";

/**
 * bioRxiv's per-subject feeds are RSS 1.0 (RDF), which the shared RSS
 * fetcher already handles. Exported so other interests' fetchers can pull a
 * different subject without duplicating the URL-building/fetch plumbing.
 */
export async function fetchBioRxivSubject(
  subject: string,
  sourceLabel: string,
  maxItems = 25
): Promise<RawItem[]> {
  const url = `https://connect.biorxiv.org/biorxiv_xml.php?subject=${encodeURIComponent(subject)}`;
  // bioRxiv's RSS description IS the paper's real abstract (unlike most RSS
  // feeds' thin teaser blurbs) — raise the cap to preserve it in full and
  // tag hasFullAbstract so the pipeline summarizes from it directly instead
  // of fetching the linked page.
  const items = await fetchRssFeed(url, sourceLabel, "academic", { maxItems, snippetMaxChars: 3000 });
  return items.map((item) => ({ ...item, hasFullAbstract: true }));
}

export async function fetchBioRxiv(maxItems = 25): Promise<RawItem[]> {
  return fetchBioRxivSubject("neuroscience", "bioRxiv", maxItems);
}

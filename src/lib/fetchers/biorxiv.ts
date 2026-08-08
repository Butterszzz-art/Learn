import type { RawItem } from "../types";
import { fetchRssFeed } from "./rss";

const BIORXIV_FEED_URL = "https://connect.biorxiv.org/biorxiv_xml.php?subject=neuroscience";

/**
 * bioRxiv's neuroscience feed is RSS 1.0 (RDF), which the shared RSS
 * fetcher already handles — this wrapper just fixes the source metadata.
 */
export async function fetchBioRxiv(maxItems = 25): Promise<RawItem[]> {
  return fetchRssFeed(BIORXIV_FEED_URL, "bioRxiv", "academic", { maxItems });
}

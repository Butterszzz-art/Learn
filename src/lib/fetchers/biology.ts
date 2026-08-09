import type { RawItem } from "../types";
import { fetchRssFeed } from "./rss";
import { fetchBioRxivSubject } from "./biorxiv";

const SCIENCEDAILY_BIOLOGY_URL = "https://www.sciencedaily.com/rss/plants_animals/biology.xml";

export async function fetchBiology(maxItemsEach = 15): Promise<RawItem[]> {
  const [sciDaily, biorxiv] = await Promise.all([
    fetchRssFeed(SCIENCEDAILY_BIOLOGY_URL, "ScienceDaily — Biology", "journalism", {
      maxItems: maxItemsEach,
    }),
    fetchBioRxivSubject("molecular_biology", "bioRxiv — Molecular Biology", maxItemsEach).catch((err) => {
      console.error("[fetchers] bioRxiv (molecular_biology) fetch failed:", err);
      return [];
    }),
  ]);
  return [...sciDaily, ...biorxiv];
}

import type { RawItem } from "../types";
import { fetchRssFeed } from "./rss";
import { fetchBioRxivSubject } from "./biorxiv";

const EVOLUTIONARY_BIOLOGY_URL = "https://www.sciencedaily.com/rss/plants_animals/evolution.xml";
const HUMAN_EVOLUTION_URL = "https://www.sciencedaily.com/rss/fossils_ruins/human_evolution.xml";

export async function fetchEvolution(maxItemsEach = 12): Promise<RawItem[]> {
  const [evoBio, humanEvo, biorxiv] = await Promise.all([
    fetchRssFeed(EVOLUTIONARY_BIOLOGY_URL, "ScienceDaily — Evolutionary Biology", "journalism", {
      maxItems: maxItemsEach,
    }),
    fetchRssFeed(HUMAN_EVOLUTION_URL, "ScienceDaily — Human Evolution", "journalism", {
      maxItems: maxItemsEach,
    }),
    fetchBioRxivSubject("evolutionary_biology", "bioRxiv — Evolutionary Biology", maxItemsEach).catch(
      (err) => {
        console.error("[fetchers] bioRxiv (evolutionary_biology) fetch failed:", err);
        return [];
      }
    ),
  ]);
  return [...evoBio, ...humanEvo, ...biorxiv];
}

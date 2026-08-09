import type { RawItem } from "../types";
import { fetchPubMed } from "./pubmed";
import { fetchArxiv } from "./arxiv";
import { fetchBioRxiv } from "./biorxiv";
import { fetchJournalism } from "./journalism";
import { fetchPsychology } from "./psychology";
import { fetchPhilosophy } from "./philosophy";
import { fetchHistory } from "./history";
import { fetchEconomics } from "./economics";
import { fetchCsAi } from "./csAi";
import { fetchPhysics } from "./physics";
import { fetchExerciseScience } from "./exerciseScience";
import { fetchMathematics } from "./mathematics";
import { fetchLogic } from "./logic";
import { fetchAnimalWorld } from "./animalWorld";
import { fetchBiology } from "./biology";
import { fetchEvolution } from "./evolution";

async function fetchNeuroscience(): Promise<RawItem[]> {
  const [pubmed, arxiv, biorxiv, journalism] = await Promise.all([
    fetchPubMed(3, 25).catch((err) => {
      console.error("[fetchers] PubMed fetch failed:", err);
      return [];
    }),
    fetchArxiv(25).catch((err) => {
      console.error("[fetchers] arXiv (neuroscience) fetch failed:", err);
      return [];
    }),
    fetchBioRxiv(25).catch((err) => {
      console.error("[fetchers] bioRxiv fetch failed:", err);
      return [];
    }),
    fetchJournalism(20).catch((err) => {
      console.error("[fetchers] Neuroscience journalism fetch failed:", err);
      return [];
    }),
  ]);
  return [...pubmed, ...arxiv, ...biorxiv, ...journalism];
}

/**
 * One entry per interest with `hasCuratedSource: true` in interestsSeed.ts.
 * Business, Political Science, Philosophy of Science, and Critical Thinking
 * & Argumentation are intentionally absent — News Roundup only (no clean
 * structured feed for the latter two; the roundup's web search covers real
 * current examples of arguments/fallacies in circulation for the latter).
 */
export const CURATED_FETCHERS: Record<string, () => Promise<RawItem[]>> = {
  neuroscience: fetchNeuroscience,
  psychology: () => fetchPsychology(20),
  philosophy: () => fetchPhilosophy(20),
  history: () => fetchHistory(20),
  economics: () => fetchEconomics(15),
  "cs-ai": () => fetchCsAi(15),
  physics: () => fetchPhysics(15),
  "exercise-science": () => fetchExerciseScience(15),
  mathematics: () => fetchMathematics(15),
  logic: () => fetchLogic(15),
  "animal-world": () => fetchAnimalWorld(12),
  biology: () => fetchBiology(15),
  evolution: () => fetchEvolution(12),
};

/** Runs the curated fetcher for one interest slug, isolating its own failures. */
export async function fetchForInterest(slug: string): Promise<RawItem[]> {
  const fetcher = CURATED_FETCHERS[slug];
  if (!fetcher) return [];
  try {
    return await fetcher();
  } catch (err) {
    console.error(`[fetchers] Curated fetch failed for interest "${slug}":`, err);
    return [];
  }
}

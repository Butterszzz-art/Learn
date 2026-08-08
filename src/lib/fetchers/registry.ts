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
 * Business and Political Science are intentionally absent — deep-dive only.
 */
export const CURATED_FETCHERS: Record<string, () => Promise<RawItem[]>> = {
  neuroscience: fetchNeuroscience,
  psychology: () => fetchPsychology(20),
  philosophy: () => fetchPhilosophy(20),
  history: () => fetchHistory(20),
  economics: () => fetchEconomics(15),
  "cs-ai": () => fetchCsAi(15),
  physics: () => fetchPhysics(15),
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

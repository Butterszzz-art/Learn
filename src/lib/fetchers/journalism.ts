import type { RawItem } from "../types";
import { fetchRssFeed } from "./rss";

// Verified to resolve as of setup — publishers occasionally move feed paths.
// If one 404s, check the site's own /rss or /feed listing page for the
// replacement and update the URL here.
const JOURNALISM_FEEDS: { name: string; url: string }[] = [
  { name: "Quanta Magazine", url: "https://www.quantamagazine.org/biology/feed/" },
  { name: "ScienceDaily — Neuroscience", url: "https://www.sciencedaily.com/rss/mind_brain/neuroscience.xml" },
  { name: "ScienceDaily — Mind & Brain", url: "https://www.sciencedaily.com/rss/mind_brain.xml" },
  { name: "ScienceDaily — Computational Biology", url: "https://www.sciencedaily.com/rss/computers_math/computational_biology.xml" },
  { name: "MIT News — Neuroscience", url: "https://news.mit.edu/rss/topic/neuroscience" },
];

/** Fetches every journalism RSS feed in parallel and merges the results. */
export async function fetchJournalism(maxItemsEach = 20): Promise<RawItem[]> {
  const results = await Promise.all(
    JOURNALISM_FEEDS.map((feed) =>
      fetchRssFeed(feed.url, feed.name, "journalism", { maxItems: maxItemsEach }).catch((err) => {
        console.error(`[journalism] ${feed.name} failed:`, err);
        return [] as RawItem[];
      })
    )
  );
  return results.flat();
}

export { JOURNALISM_FEEDS };

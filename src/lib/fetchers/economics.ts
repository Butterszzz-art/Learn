import type { RawItem } from "../types";
import { fetchRssFeed } from "./rss";

// NBER redirects http(s)://www.nber.org/rss/new.xml -> back.nber.org; fetch()
// follows redirects by default, so the canonical URL is used here as-is.
const NBER_FEED_URL = "https://www.nber.org/rss/new.xml";
const MARGINAL_REVOLUTION_FEED_URL = "https://marginalrevolution.com/feed";

export async function fetchEconomics(maxItemsEach = 15): Promise<RawItem[]> {
  const [nber, mr] = await Promise.all([
    fetchRssFeed(NBER_FEED_URL, "NBER Working Papers", "academic", { maxItems: maxItemsEach }),
    fetchRssFeed(MARGINAL_REVOLUTION_FEED_URL, "Marginal Revolution", "journalism", {
      maxItems: maxItemsEach,
    }),
  ]);
  return [...nber, ...mr];
}

import type { RawItem } from "../types";
import { fetchRssFeed } from "./rss";

const PSYCHOLOGY_FEED_URL = "https://www.sciencedaily.com/rss/mind_brain/psychology.xml";

export async function fetchPsychology(maxItems = 20): Promise<RawItem[]> {
  return fetchRssFeed(PSYCHOLOGY_FEED_URL, "ScienceDaily — Psychology", "journalism", { maxItems });
}

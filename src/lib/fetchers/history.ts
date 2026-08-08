import type { RawItem } from "../types";
import { fetchRssFeed } from "./rss";

const JSTOR_DAILY_FEED_URL = "https://daily.jstor.org/feed/";

export async function fetchHistory(maxItems = 20): Promise<RawItem[]> {
  return fetchRssFeed(JSTOR_DAILY_FEED_URL, "JSTOR Daily", "journalism", { maxItems });
}

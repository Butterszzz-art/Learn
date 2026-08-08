import type { RawItem } from "../types";
import { fetchRssFeed } from "./rss";

const AEON_FEED_URL = "https://aeon.co/feed.rss";

// Aeon's RSS carries no <category> tags (verified at setup), and the feed
// itself mixes philosophy with science/culture essays. Best-effort keyword
// filter per the spec's "where possible" — if it would zero out the whole
// batch (heuristic too strict, or this refresh just didn't have any), fall
// back to the unfiltered set rather than showing nothing from the
// designated philosophy source.
const PHILOSOPHY_KEYWORDS =
  /philosoph|ethic|moral|metaphysic|epistemolog|existential|phenomenolog|ontolog|\bfree will\b|consciousness|meaning of life|virtue|stoic|kant|nietzsche|aristotle|plato|socrat|wittgenstein|hegel|heidegger|utilitarian|dualis|determinis|skeptic/i;

export async function fetchPhilosophy(maxItems = 20): Promise<RawItem[]> {
  const all = await fetchRssFeed(AEON_FEED_URL, "Aeon", "journalism", { maxItems: maxItems * 2 });
  const filtered = all.filter((item) => PHILOSOPHY_KEYWORDS.test(`${item.title} ${item.snippet}`));
  return (filtered.length > 0 ? filtered : all).slice(0, maxItems);
}

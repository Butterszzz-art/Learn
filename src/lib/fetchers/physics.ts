import type { RawItem } from "../types";
import { queryArxiv } from "./arxiv";
import { fetchRssFeed } from "./rss";

const SCIENCEDAILY_PHYSICS_URL = "https://www.sciencedaily.com/rss/matter_energy/physics.xml";

export async function fetchPhysics(maxItemsEach = 15): Promise<RawItem[]> {
  const [arxiv, sciDaily] = await Promise.all([
    queryArxiv("cat:quant-ph", maxItemsEach),
    fetchRssFeed(SCIENCEDAILY_PHYSICS_URL, "ScienceDaily — Physics", "journalism", {
      maxItems: maxItemsEach,
    }),
  ]);
  return [...arxiv, ...sciDaily];
}

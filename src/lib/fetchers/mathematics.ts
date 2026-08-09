import type { RawItem } from "../types";
import { fetchRssFeed } from "./rss";

const QUANTA_MATH_URL = "https://www.quantamagazine.org/mathematics/feed/";
const SCIENCEDAILY_MATH_URL = "https://www.sciencedaily.com/rss/computers_math/mathematics.xml";

export async function fetchMathematics(maxItemsEach = 15): Promise<RawItem[]> {
  const [quanta, sciDaily] = await Promise.all([
    fetchRssFeed(QUANTA_MATH_URL, "Quanta Magazine — Mathematics", "journalism", {
      maxItems: maxItemsEach,
    }),
    fetchRssFeed(SCIENCEDAILY_MATH_URL, "ScienceDaily — Mathematics", "journalism", {
      maxItems: maxItemsEach,
    }),
  ]);
  return [...quanta, ...sciDaily];
}

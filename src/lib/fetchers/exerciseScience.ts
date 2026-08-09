import type { RawItem } from "../types";
import { fetchRssFeed } from "./rss";

const SPORTS_SCIENCE_URL = "https://www.sciencedaily.com/rss/matter_energy/sports_science.xml";
const FITNESS_URL = "https://www.sciencedaily.com/rss/health_medicine/fitness.xml";

export async function fetchExerciseScience(maxItemsEach = 15): Promise<RawItem[]> {
  const [sportsScience, fitness] = await Promise.all([
    fetchRssFeed(SPORTS_SCIENCE_URL, "ScienceDaily — Sports Science", "journalism", {
      maxItems: maxItemsEach,
    }),
    fetchRssFeed(FITNESS_URL, "ScienceDaily — Fitness", "journalism", { maxItems: maxItemsEach }),
  ]);
  return [...sportsScience, ...fitness];
}

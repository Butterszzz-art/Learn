import type { RawItem } from "../types";
import { fetchRssFeed } from "./rss";
import { fetchBioRxivSubject } from "./biorxiv";

const ANIMALS_URL = "https://www.sciencedaily.com/rss/plants_animals/animals.xml";
const ANIMAL_LEARNING_URL =
  "https://www.sciencedaily.com/rss/plants_animals/animal_learning_and_intelligence.xml";

export async function fetchAnimalWorld(maxItemsEach = 12): Promise<RawItem[]> {
  const [animals, learning, biorxiv] = await Promise.all([
    fetchRssFeed(ANIMALS_URL, "ScienceDaily — Animals", "journalism", { maxItems: maxItemsEach }),
    fetchRssFeed(ANIMAL_LEARNING_URL, "ScienceDaily — Animal Learning & Intelligence", "journalism", {
      maxItems: maxItemsEach,
    }),
    fetchBioRxivSubject("animal_behavior", "bioRxiv — Animal Behavior and Cognition", maxItemsEach).catch(
      (err) => {
        console.error("[fetchers] bioRxiv (animal_behavior) fetch failed:", err);
        return [];
      }
    ),
  ]);
  return [...animals, ...learning, ...biorxiv];
}

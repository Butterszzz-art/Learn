import type { RawItem } from "../types";
import { queryArxiv } from "./arxiv";

export async function fetchCsAi(maxResults = 15): Promise<RawItem[]> {
  return queryArxiv("cat:cs.AI", maxResults);
}

import type { RawItem } from "../types";
import { queryArxiv } from "./arxiv";

export async function fetchLogic(maxResults = 15): Promise<RawItem[]> {
  return queryArxiv("cat:math.LO", maxResults);
}

import type { RawItem } from "./types";

/**
 * Ranks items so the digest can surface the most substantive ~15-20 rather
 * than everything fetched. Deliberately simple and explainable:
 *   - recency: newer items score higher, decaying over ~14 days
 *   - substance: longer abstracts/snippets (a rough proxy for depth) score higher
 *   - academic bonus: peer-reviewed/preprint sources get a small edge over
 *     journalism, since the digest's core is research coverage
 */
export function scoreItem(item: RawItem): number {
  let score = 0;

  if (item.publishedAt) {
    const ageDays = (Date.now() - new Date(item.publishedAt).getTime()) / 86_400_000;
    score += Math.max(0, 14 - ageDays) * 2; // up to 28 points, decaying to 0 past 14 days
  } else {
    score += 5; // unknown date — treat as moderately fresh rather than penalizing hard
  }

  const snippetLen = (item.snippet || "").length;
  score += Math.min(snippetLen / 20, 15); // up to 15 points for substantive abstracts

  if (item.sourceType === "academic") score += 6;

  return score;
}

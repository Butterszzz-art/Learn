// How much of a card's summary to show. A reader picks a default in
// Settings and can preview any other length on a single card with the
// switcher under it.
//
//   brief    — the first couple of sentences, for skimming
//   standard — the full card text (about 90-150 words on new cards)
//   indepth  — a longer write-up of the same idea (about 220-350 words),
//              written alongside the card, or on first request for older ones
export const SUMMARY_LENGTHS = ["brief", "standard", "indepth"] as const;
export type SummaryLength = (typeof SUMMARY_LENGTHS)[number];
export const DEFAULT_SUMMARY_LENGTH: SummaryLength = "standard";

export const SUMMARY_LENGTH_LABELS: Record<SummaryLength, string> = {
  brief: "Brief",
  standard: "Standard",
  indepth: "In-depth",
};

export function isSummaryLength(v: unknown): v is SummaryLength {
  return typeof v === "string" && (SUMMARY_LENGTHS as readonly string[]).includes(v);
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Whole minutes at an unhurried 200 words a minute, never less than one. */
export function readMinutes(text: string): number {
  return Math.max(1, Math.round(wordCount(text) / 200));
}

/** The first `sentences` sentences of a text — used for the Brief length. */
export function briefOf(text: string, sentences = 2): string {
  const parts = text.trim().match(/[^.!?]+(?:[.!?]+["”’)\]]*|$)\s*/g);
  if (!parts || parts.length <= sentences) return text.trim();
  return parts.slice(0, sentences).join("").trim();
}

/** Cuts a long text at a word boundary near `chars`, adding an ellipsis. */
export function clipAt(text: string, chars: number): string {
  const t = text.trim();
  if (t.length <= chars) return t;
  return t.slice(0, chars).replace(/\s+\S*$/, "") + "…";
}

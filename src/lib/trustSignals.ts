// ---------------------------------------------------------------------------
// Phase 15 — Trust Signals. A pure transparency layer: nothing here changes
// what gets generated (the paraphrase-and-cite discipline has been in place
// since Phase 1) — these functions just classify already-existing content as
// "grounded" (draws directly from a specific identifiable source: a paper,
// an article, the reader's own uploaded book) or "synthesized" (the model
// connecting ideas or discussing open questions with no one pinpoint
// source), so readers can calibrate trust per item instead of assuming a
// uniform standard across every card in the feed.
// ---------------------------------------------------------------------------

export type SourceClassification = "grounded" | "synthesized";

/** News items always have exactly one identifiable source — the article/
 * paper they were fetched or found from — so they're always grounded. */
export function classifyNewsItem(): SourceClassification {
  return "grounded";
}

/** A Deep Dive is grounded when its gather step actually found real
 * sources to write from; on the rare occasion gathering came back with
 * none, it's leaning on general background knowledge instead — synthesized. */
export function classifyDeepDive(sourceCount: number): SourceClassification {
  return sourceCount > 0 ? "grounded" : "synthesized";
}

/** A Drill grounded in a real source deep dive or Library chapter draws
 * directly from that one identifiable source; a standalone formal-logic
 * drill has no source material at all — pure synthesis. */
export function classifyDrill(hasSource: boolean): SourceClassification {
  return hasSource ? "grounded" : "synthesized";
}

/** Mental Model lenses connect a general-purpose thinking tool to one or two
 * of the week's items — genuine synthesis by construction, never a single
 * pinpoint source, even though it references real items. */
export function classifyMentalModelLens(): SourceClassification {
  return "synthesized";
}

/** Applied Insights extrapolate a practical takeaway from a Deep Dive/Drill
 * — connecting the dive's ideas to daily life, not itself a sourced claim. */
export function classifyAppliedInsight(): SourceClassification {
  return "synthesized";
}

/** A Steelman counterargument is the model's own construction of the
 * strongest good-faith opposing case — synthesized even when it cites real
 * background context. */
export function classifySteelman(): SourceClassification {
  return "synthesized";
}

/** Explain-it-back feedback responds to the reader's own writing — there's
 * no external source to be grounded in. */
export function classifyExplainBackFeedback(): SourceClassification {
  return "synthesized";
}

/** A Library book chapter's summary/key-concepts draw directly from the
 * reader's own uploaded book — the clearest case of "grounded" there is. */
export function classifyChapterContent(): SourceClassification {
  return "grounded";
}

/** Rabbit Hole items carry one real, specific source URL, same as News. */
export function classifyRabbitHole(): SourceClassification {
  return "grounded";
}

export const SYNTHESIZED_NOTE = "General synthesis — verify specifics before citing.";

// Phase 14 (Cost Optimization) — engagement-based pruning. Two halves:
//  1. logEngagementEvent(): a cheap write, called from the UI as the reader
//     actually interacts with the stream (viewed / expanded / answered /
//     skipped — see src/app/api/events/route.ts and the stream components
//     that call it).
//  2. runPruningSweep(): computed on the scheduled pipeline's cadence (see
//     scripts/submitBatch.ts), reads a rolling engagement rate per
//     (interest, content type) and flips a sustained-low-engagement
//     combination from "auto" to "on_demand" in contentGenerationPrefs —
//     read back by the generation pipeline (isAutoGenerationEnabled) to
//     skip auto-generating it, and surfaced to the reader as a dismissible
//     notice with an easy way to turn it back on.
import { db } from "@/db";
import { engagementEvents, contentGenerationPrefs, items, deepDives, appliedInsights, drills, interests } from "@/db/schema";
import type { PrunableContentType, EngagementEventType, GenerationMode } from "@/db/schema";
import { PRUNABLE_CONTENT_TYPES } from "@/db/schema";
import { eq, and, gte, inArray, isNull, isNotNull } from "drizzle-orm";
import { getEnabledInterests } from "./interests";
export { CONTENT_TYPE_LABELS } from "./contentTypeLabels";

/** Logs one interaction. Best-effort — a failed write here should never
 * break the reading experience, so callers (the /api/events route) swallow
 * errors rather than surface them. */
export async function logEngagementEvent(
  itemId: number,
  itemType: PrunableContentType,
  interestId: number | null,
  eventType: EngagementEventType
): Promise<void> {
  await db.insert(engagementEvents).values({ itemId, itemType, interestId, eventType });
}

/** How far back to look for "generated" rows when judging engagement — long
 * enough to span several cycles (weekly-cadence content types get ~6 cycles'
 * worth, News' daily cadence gets ~2 weeks) so a single sweep already
 * reflects a sustained stretch rather than one bad week. */
const LOOKBACK_DAYS: Record<PrunableContentType, number> = {
  news: 14,
  deep_dive: 42,
  applied_insight: 42,
  drill: 42,
  steelman: 42,
};

// Don't judge a combination that hasn't generated enough content yet to mean
// anything — a single unviewed item is not a trend.
const MIN_GENERATED_FOR_SIGNAL = 3;
// "under ~20% actually viewed" per spec.
const ENGAGEMENT_THRESHOLD = 0.2;
const ENGAGED_EVENT_TYPES: EngagementEventType[] = ["viewed", "expanded", "answered"];

function daysAgoSqlite(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace("T", " ");
}

/** Row ids of this content type generated for this interest within the
 * lookback window — the denominator for engagement rate, and the id space
 * engagementEvents.itemId is checked against. */
async function getGeneratedIds(interestId: number, contentType: PrunableContentType, cutoff: string): Promise<number[]> {
  switch (contentType) {
    case "news": {
      const rows = await db
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.interestId, interestId), gte(items.fetchedAt, cutoff)));
      return rows.map((r) => r.id);
    }
    case "deep_dive": {
      const rows = await db
        .select({ id: deepDives.id })
        .from(deepDives)
        .where(and(eq(deepDives.interestId, interestId), gte(deepDives.createdAt, cutoff)));
      return rows.map((r) => r.id);
    }
    case "applied_insight": {
      const rows = await db
        .select({ id: appliedInsights.id })
        .from(appliedInsights)
        .where(and(eq(appliedInsights.interestId, interestId), gte(appliedInsights.createdAt, cutoff)));
      return rows.map((r) => r.id);
    }
    case "drill": {
      const rows = await db
        .select({ id: drills.id })
        .from(drills)
        .where(and(eq(drills.interestId, interestId), gte(drills.createdAt, cutoff)));
      return rows.map((r) => r.id);
    }
    case "steelman": {
      // Steelman isn't its own table — it's items.steelman_content, and its
      // engagement events reference the same items.id under itemType
      // "steelman" (a separate interaction from that item's own "news"
      // viewing — see the Steelman card's view/expand handler).
      const rows = await db
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.interestId, interestId), isNotNull(items.steelmanContent), gte(items.fetchedAt, cutoff)));
      return rows.map((r) => r.id);
    }
  }
}

export interface EngagementStats {
  generated: number;
  engaged: number;
  rate: number | null; // null = not enough data yet to judge
}

/** Rolling engagement rate for one (interest, contentType) pair. */
export async function computeEngagementRate(
  interestId: number,
  contentType: PrunableContentType
): Promise<EngagementStats> {
  const cutoff = daysAgoSqlite(LOOKBACK_DAYS[contentType]);
  const generatedIds = await getGeneratedIds(interestId, contentType, cutoff);
  if (generatedIds.length < MIN_GENERATED_FOR_SIGNAL) {
    return { generated: generatedIds.length, engaged: 0, rate: null };
  }

  const events = await db
    .select({ itemId: engagementEvents.itemId })
    .from(engagementEvents)
    .where(
      and(
        eq(engagementEvents.interestId, interestId),
        eq(engagementEvents.itemType, contentType),
        inArray(engagementEvents.eventType, ENGAGED_EVENT_TYPES),
        inArray(engagementEvents.itemId, generatedIds)
      )
    );
  const engagedCount = new Set(events.map((e) => e.itemId)).size;
  return { generated: generatedIds.length, engaged: engagedCount, rate: engagedCount / generatedIds.length };
}

async function getPrefRow(interestId: number, contentType: PrunableContentType) {
  const rows = await db
    .select()
    .from(contentGenerationPrefs)
    .where(and(eq(contentGenerationPrefs.interestId, interestId), eq(contentGenerationPrefs.contentType, contentType)))
    .limit(1);
  return rows[0] ?? null;
}

/** Whether the scheduled pipeline should keep auto-generating this
 * (interest, contentType) combination — true (the default) unless the
 * pruning sweep (or a prior state) has flipped it to on_demand. */
export async function isAutoGenerationEnabled(interestId: number, contentType: PrunableContentType): Promise<boolean> {
  const row = await getPrefRow(interestId, contentType);
  return (row?.mode ?? "auto") === "auto";
}

/** Sets a combination's mode directly — used by both the pruning sweep
 * (auto -> on_demand) and the reader's "turn back on" action
 * (on_demand -> auto). Resets the notice-dismissed flag on every change so a
 * later re-prune surfaces a fresh notice rather than staying silently
 * suppressed by an old dismissal. */
export async function setGenerationMode(interestId: number, contentType: PrunableContentType, mode: GenerationMode): Promise<void> {
  const existing = await getPrefRow(interestId, contentType);
  const now = new Date().toISOString();
  if (existing) {
    await db
      .update(contentGenerationPrefs)
      .set({ mode, switchedAt: now, noticeDismissedAt: null })
      .where(eq(contentGenerationPrefs.id, existing.id));
  } else {
    await db.insert(contentGenerationPrefs).values({ interestId, contentType, mode, switchedAt: now });
  }
}

/** The reader's "turn this back on" action — always available, regardless
 * of current engagement, per spec ("make it easy to turn back on"). */
export async function resumeAutoGeneration(interestId: number, contentType: PrunableContentType): Promise<void> {
  await setGenerationMode(interestId, contentType, "auto");
}

export interface PruningNotice {
  interestId: number;
  interestName: string;
  contentType: PrunableContentType;
  switchedAt: string | null;
}

/** Every (interest, contentType) currently in on_demand mode whose notice
 * hasn't been dismissed yet — surfaced in the feed as small, dismissible
 * "switched to on-demand" cards. */
export async function getActivePruningNotices(): Promise<PruningNotice[]> {
  const rows = await db
    .select({ pref: contentGenerationPrefs, interest: interests })
    .from(contentGenerationPrefs)
    .innerJoin(interests, eq(contentGenerationPrefs.interestId, interests.id))
    .where(and(eq(contentGenerationPrefs.mode, "on_demand"), isNull(contentGenerationPrefs.noticeDismissedAt)));
  return rows.map((r) => ({
    interestId: r.interest.id,
    interestName: r.interest.name,
    contentType: r.pref.contentType,
    switchedAt: r.pref.switchedAt,
  }));
}

/** Dismisses the notice without changing the mode — the content type stays
 * on_demand, the reader just doesn't want to see the banner anymore. */
export async function dismissPruningNotice(interestId: number, contentType: PrunableContentType): Promise<void> {
  const existing = await getPrefRow(interestId, contentType);
  if (!existing) return;
  await db
    .update(contentGenerationPrefs)
    .set({ noticeDismissedAt: new Date().toISOString() })
    .where(eq(contentGenerationPrefs.id, existing.id));
}

/**
 * Run once per scheduled cycle (see scripts/submitBatch.ts, before
 * assembling that round's requests): for every enabled interest and every
 * prunable content type still in "auto" mode, checks the rolling engagement
 * rate and flips it to "on_demand" if it's sustained below threshold.
 * Content types with too little generated history to judge (rate === null)
 * are left alone — includes ones that don't apply to a given interest at
 * all (e.g. Steelman for an interest with nothing steelman-eligible), since
 * those simply never accumulate any generated rows to judge. Returns the
 * combinations that were newly pruned this sweep.
 */
export async function runPruningSweep(): Promise<{ interestId: number; contentType: PrunableContentType }[]> {
  const enabledInterests = await getEnabledInterests();
  const flipped: { interestId: number; contentType: PrunableContentType }[] = [];

  for (const interest of enabledInterests) {
    for (const contentType of PRUNABLE_CONTENT_TYPES) {
      if (!(await isAutoGenerationEnabled(interest.id, contentType))) continue; // already pruned
      const stats = await computeEngagementRate(interest.id, contentType);
      if (stats.rate == null) continue;
      if (stats.rate < ENGAGEMENT_THRESHOLD) {
        await setGenerationMode(interest.id, contentType, "on_demand");
        flipped.push({ interestId: interest.id, contentType });
      }
    }
  }

  return flipped;
}

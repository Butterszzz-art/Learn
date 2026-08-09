import { db } from "@/db";
import { interests, userInterests, coveredTopics } from "@/db/schema";
import type { Level } from "@/db/schema";
import { eq, asc, desc, inArray, count } from "drizzle-orm";

export interface InterestWithConfig {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  hasCuratedSource: boolean;
  isCustom: boolean;
  generatesAppliedInsights: boolean;
  isFavorite: boolean;
  level: Level;
  enabled: boolean;
}

/** Every interest in the catalog, joined with the user's config (defaults applied if unset). */
export async function getAllInterests(): Promise<InterestWithConfig[]> {
  const allInterests = await db.select().from(interests).orderBy(asc(interests.id));
  const configs = await db.select().from(userInterests);
  const configById = new Map(configs.map((c) => [c.interestId, c]));

  return allInterests.map((i) => {
    const config = configById.get(i.id);
    return {
      id: i.id,
      slug: i.slug,
      name: i.name,
      description: i.description,
      hasCuratedSource: i.hasCuratedSource,
      isCustom: i.isCustom,
      generatesAppliedInsights: i.generatesAppliedInsights,
      isFavorite: i.isFavorite,
      level: config?.level ?? "some_background",
      enabled: config?.enabled ?? false,
    };
  });
}

/** Only the interests the user has explicitly enabled. */
export async function getEnabledInterests(): Promise<InterestWithConfig[]> {
  const all = await getAllInterests();
  return all.filter((i) => i.enabled);
}

/** Single interest by id, with config — used by the granular per-step refresh endpoints. */
export async function getInterestById(id: number): Promise<InterestWithConfig | null> {
  const all = await getAllInterests();
  return all.find((i) => i.id === id) ?? null;
}

/** True once the user has saved at least one interest config — gates onboarding. */
export async function hasCompletedOnboarding(): Promise<boolean> {
  const rows = await db.select({ interestId: userInterests.interestId }).from(userInterests).limit(1);
  return rows.length > 0;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "interest"
  );
}

/**
 * Creates a user-typed custom interest (Phase 3 — the seed list is
 * suggestions, not a ceiling). Always hasCuratedSource=false: there's no
 * registered fetcher for an arbitrary field, so it gets a generated Field
 * News Roundup instead. Slug collisions get a numeric suffix.
 */
export async function createCustomInterest(
  name: string,
  generatesAppliedInsights = true
): Promise<InterestWithConfig> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Interest name can't be empty");

  const base = slugify(trimmed);
  let slug = base;
  let suffix = 2;
  while ((await db.select({ id: interests.id }).from(interests).where(eq(interests.slug, slug))).length > 0) {
    slug = `${base}-${suffix}`;
    suffix++;
  }

  const inserted = await db
    .insert(interests)
    .values({
      slug,
      name: trimmed,
      description: null,
      hasCuratedSource: false,
      isCustom: true,
      generatesAppliedInsights,
    })
    .returning();

  const row = inserted[0];
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    hasCuratedSource: row.hasCuratedSource,
    isCustom: row.isCustom,
    generatesAppliedInsights: row.generatesAppliedInsights,
    isFavorite: row.isFavorite,
    level: "some_background",
    enabled: false,
  };
}

/** Enable/disable an interest and set its level. Upserts — safe to call repeatedly. */
export async function setUserInterest(interestId: number, level: Level, enabled: boolean) {
  const existing = await db
    .select()
    .from(userInterests)
    .where(eq(userInterests.interestId, interestId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(userInterests)
      .set({ level, enabled })
      .where(eq(userInterests.interestId, interestId));
  } else {
    await db.insert(userInterests).values({ interestId, level, enabled });
  }
}

/** Bulk save — used by both onboarding and the settings page. */
export async function saveUserInterests(
  updates: { interestId: number; level: Level; enabled: boolean }[]
) {
  for (const u of updates) {
    await setUserInterest(u.interestId, u.level, u.enabled);
  }
}

/** Per-interest override for whether deep dives get an Applied Insight card. */
export async function setGeneratesAppliedInsights(interestId: number, value: boolean) {
  await db.update(interests).set({ generatesAppliedInsights: value }).where(eq(interests.id, interestId));
}

/** Passion Mode toggle — from Settings or a single star tap in the feed. */
export async function setIsFavorite(interestId: number, value: boolean) {
  await db.update(interests).set({ isFavorite: value }).where(eq(interests.id, interestId));
}

export interface CoveredTopicsInfo {
  recent: string[]; // chronological order, bounded — for prompt context
  totalCount: number; // full history length — the escalation signal ("this is entry #N")
}

/**
 * Recent covered-topic strings for an interest (chronological, bounded for
 * prompt size) plus the full-history count, which is the signal deep-dive
 * generation uses to keep escalating sophistication over weeks/months
 * instead of plateauing at an intro level (see deepDive.ts).
 */
export async function getCoveredTopics(interestId: number, limit = 20): Promise<CoveredTopicsInfo> {
  const rows = await db
    .select({ topic: coveredTopics.topic })
    .from(coveredTopics)
    .where(eq(coveredTopics.interestId, interestId))
    .orderBy(desc(coveredTopics.dateCovered))
    .limit(limit);

  const totalRows = await db
    .select({ value: count() })
    .from(coveredTopics)
    .where(eq(coveredTopics.interestId, interestId));

  return {
    recent: rows.map((r) => r.topic).reverse(), // chronological order for the prompt
    totalCount: totalRows[0]?.value ?? rows.length,
  };
}

// Spaced resurfacing schedule (Phase 4): simple fixed days-out sequence, not
// a full SM-2 implementation, per spec. Index 0 is the first review after a
// topic is newly covered; each subsequent review pushes further out, capped
// at the last entry rather than growing indefinitely.
const REVIEW_SCHEDULE_DAYS = [3, 7, 21, 60];

/** Formats a future Date to match SQLite's own `current_timestamp` shape
 * ("YYYY-MM-DD HH:MM:SS", UTC, no offset marker) so the two stay directly
 * comparable/sortable as plain text. */
function daysFromNowSqlite(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 19).replace("T", " ");
}

/** Logs a newly-covered topic and schedules its first spaced-review date.
 * deepDiveId links back to the entry so a later "Remember this?" card can
 * pull a refresher from it. */
export async function addCoveredTopic(interestId: number, topic: string, deepDiveId: number) {
  await db.insert(coveredTopics).values({
    interestId,
    topic,
    deepDiveId,
    nextReviewDate: daysFromNowSqlite(REVIEW_SCHEDULE_DAYS[0]),
    reviewCount: 0,
  });
}

/** Called when a resurfaced "Remember this?" card is actually opened —
 * pushes that topic's next review further out on the fixed schedule above.
 * Not called just for being shown; only for being opened/read. */
export async function markTopicReviewed(coveredTopicId: number): Promise<void> {
  const rows = await db
    .select({ reviewCount: coveredTopics.reviewCount })
    .from(coveredTopics)
    .where(eq(coveredTopics.id, coveredTopicId))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  const newCount = row.reviewCount + 1;
  const days = REVIEW_SCHEDULE_DAYS[Math.min(newCount, REVIEW_SCHEDULE_DAYS.length - 1)];
  await db
    .update(coveredTopics)
    .set({ reviewCount: newCount, nextReviewDate: daysFromNowSqlite(days) })
    .where(eq(coveredTopics.id, coveredTopicId));
}

/** Convenience lookup used to gate legacy Phase 1 features (Brain Fact of the Day). */
export async function isInterestEnabled(slug: string): Promise<boolean> {
  const rows = await db
    .select({ id: interests.id })
    .from(interests)
    .where(eq(interests.slug, slug))
    .limit(1);
  const id = rows[0]?.id;
  if (!id) return false;
  const configs = await db
    .select({ enabled: userInterests.enabled })
    .from(userInterests)
    .where(eq(userInterests.interestId, id))
    .limit(1);
  return configs[0]?.enabled ?? false;
}

export async function getInterestsBySlug(slugs: string[]) {
  if (slugs.length === 0) return [];
  return db.select().from(interests).where(inArray(interests.slug, slugs));
}

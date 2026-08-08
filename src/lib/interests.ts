import { db } from "@/db";
import { interests, userInterests, coveredTopics } from "@/db/schema";
import type { Level } from "@/db/schema";
import { eq, asc, desc, inArray } from "drizzle-orm";

export interface InterestWithConfig {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  hasCuratedSource: boolean;
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

/** True once the user has saved at least one interest config — gates onboarding. */
export async function hasCompletedOnboarding(): Promise<boolean> {
  const rows = await db.select({ interestId: userInterests.interestId }).from(userInterests).limit(1);
  return rows.length > 0;
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

/** Recent covered-topic strings for an interest, oldest first (syllabus order) — bounded for prompt size. */
export async function getCoveredTopics(interestId: number, limit = 20): Promise<string[]> {
  const rows = await db
    .select({ topic: coveredTopics.topic })
    .from(coveredTopics)
    .where(eq(coveredTopics.interestId, interestId))
    .orderBy(desc(coveredTopics.dateCovered))
    .limit(limit);
  return rows.map((r) => r.topic).reverse(); // chronological order for the prompt
}

export async function addCoveredTopic(interestId: number, topic: string) {
  await db.insert(coveredTopics).values({ interestId, topic });
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

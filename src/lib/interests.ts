import { db, client } from "@/db";
import { interests, userInterests, deepDives } from "@/db/schema";
import type { Level } from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";

export interface InterestRow {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  hasCuratedSource: boolean;
  isCustom: boolean;
  generatesAppliedInsights: boolean;
  isLibraryBook: boolean;
}

/** An interest plus one person's settings for it. */
export interface InterestWithConfig extends InterestRow {
  level: Level;
  enabled: boolean;
  isFavorite: boolean;
}

function toRow(i: typeof interests.$inferSelect): InterestRow {
  return {
    id: i.id,
    slug: i.slug,
    name: i.name,
    description: i.description,
    hasCuratedSource: i.hasCuratedSource,
    isCustom: i.isCustom,
    generatesAppliedInsights: i.generatesAppliedInsights,
    isLibraryBook: i.isLibraryBook,
  };
}

export async function getInterestRow(id: number): Promise<InterestRow | null> {
  const rows = await db.select().from(interests).where(eq(interests.id, id)).limit(1);
  return rows[0] ? toRow(rows[0]) : null;
}

export async function getInterestRowBySlug(slug: string): Promise<InterestRow | null> {
  const rows = await db.select().from(interests).where(eq(interests.slug, slug)).limit(1);
  return rows[0] ? toRow(rows[0]) : null;
}

/**
 * The interest list one person sees: every seeded interest, plus custom
 * ones they follow. Library pseudo-interests are never listed.
 */
export async function getCatalog(userId: number): Promise<InterestWithConfig[]> {
  const all = await db.select().from(interests).orderBy(asc(interests.id));
  const configs = await db.select().from(userInterests).where(eq(userInterests.userId, userId));
  const byId = new Map(configs.map((c) => [c.interestId, c]));
  return all
    .filter((i) => !i.isLibraryBook && (!i.isCustom || byId.has(i.id)))
    .map((i) => {
      const c = byId.get(i.id);
      return {
        ...toRow(i),
        level: c?.level ?? "some_background",
        enabled: c?.enabled ?? false,
        isFavorite: c?.isFavorite ?? false,
      };
    });
}

export async function getEnabledInterests(userId: number): Promise<InterestWithConfig[]> {
  return (await getCatalog(userId)).filter((i) => i.enabled);
}

export async function getUserInterest(userId: number, interestId: number): Promise<InterestWithConfig | null> {
  return (await getCatalog(userId)).find((i) => i.id === interestId) ?? null;
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "interest"
  );
}

/**
 * Follows a user-typed field. Custom interests are shared rows: if someone
 * already added the same field, this person joins that pool instead of
 * creating a duplicate — which is what lets its content be generated once.
 */
export async function createCustomInterest(userId: number, name: string): Promise<InterestRow> {
  const trimmed = name.trim().replace(/\s+/g, " ").slice(0, 60);
  if (trimmed.length < 2) throw new Error("Interest name is too short");
  const slug = slugify(trimmed);

  const existing = await db.select().from(interests).where(eq(interests.slug, slug)).limit(1);
  if (existing[0] && !existing[0].isLibraryBook) return toRow(existing[0]);

  const inserted = await db
    .insert(interests)
    .values({
      slug: existing[0] ? `${slug}-topic` : slug,
      name: trimmed,
      description: null,
      hasCuratedSource: false,
      isCustom: true,
      generatesAppliedInsights: true,
      createdByUserId: userId,
    })
    .returning();
  return toRow(inserted[0]);
}

/** Hidden pseudo-interest for a Library book, so its concepts have a home. */
export async function getOrCreateLibraryInterest(bookId: number, bookTitle: string): Promise<InterestRow> {
  const slug = `library-book-${bookId}`;
  const existing = await db.select().from(interests).where(eq(interests.slug, slug)).limit(1);
  if (existing[0]) return toRow(existing[0]);
  const inserted = await db
    .insert(interests)
    .values({
      slug,
      name: `Library: ${bookTitle}`,
      description: null,
      hasCuratedSource: false,
      isCustom: false,
      generatesAppliedInsights: false,
      isLibraryBook: true,
    })
    .returning();
  return toRow(inserted[0]);
}

export async function setUserInterest(
  userId: number,
  interestId: number,
  level: Level,
  enabled: boolean
): Promise<void> {
  await client.execute({
    sql: `INSERT INTO user_interest_prefs (user_id, interest_id, level, enabled) VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, interest_id) DO UPDATE SET level = excluded.level, enabled = excluded.enabled`,
    args: [userId, interestId, level, enabled ? 1 : 0],
  });
}

export async function saveUserInterests(
  userId: number,
  updates: { interestId: number; level: Level; enabled: boolean }[]
): Promise<void> {
  for (const u of updates) await setUserInterest(userId, u.interestId, u.level, u.enabled);
}

export async function setIsFavorite(userId: number, interestId: number, value: boolean): Promise<void> {
  await db
    .update(userInterests)
    .set({ isFavorite: value })
    .where(and(eq(userInterests.userId, userId), eq(userInterests.interestId, interestId)));
}

export interface CoveredTopicsInfo {
  recent: string[]; // chronological, bounded — prompt context
  totalCount: number; // length of the whole series — the "entry #N" signal
}

/**
 * Topics already written for an (interest, level) series, oldest first.
 * The series is shared: everyone at this level in this interest walks the
 * same sequence, so each entry is written once.
 */
export async function getSeriesTopics(interestId: number, level: Level, limit = 25): Promise<CoveredTopicsInfo> {
  const rows = await db
    .select({ topic: deepDives.topic })
    .from(deepDives)
    .where(and(eq(deepDives.interestId, interestId), eq(deepDives.level, level)))
    .orderBy(asc(deepDives.seq), asc(deepDives.id));
  return { recent: rows.slice(-limit).map((r) => r.topic), totalCount: rows.length };
}

export async function getInterestsBySlug(slugs: string[]) {
  if (slugs.length === 0) return [];
  return db.select().from(interests).where(inArray(interests.slug, slugs));
}

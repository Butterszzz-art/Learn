import { db } from "@/db";
import { digests, items, brainFacts, settings } from "@/db/schema";
import type { Category } from "@/db/schema";
import { CATEGORIES } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export interface DigestItem {
  id: number;
  title: string;
  authors: string | null;
  summary: string;
  sourceName: string;
  sourceType: string;
  category: Category;
  url: string;
  publishedAt: string | null;
}

export interface DigestView {
  id: number;
  periodLabel: string;
  frequency: string;
  createdAt: string;
  brainFact: { text: string; topic: string | null } | null;
  itemsByCategory: { category: Category; items: DigestItem[] }[];
  totalItems: number;
}

function groupByCategory(rows: DigestItem[]): { category: Category; items: DigestItem[] }[] {
  const grouped: { category: Category; items: DigestItem[] }[] = [];
  for (const category of CATEGORIES) {
    const inCategory = rows.filter((r) => r.category === category);
    if (inCategory.length > 0) grouped.push({ category, items: inCategory });
  }
  return grouped;
}

async function loadDigest(digestId: number): Promise<DigestView | null> {
  const digestRows = await db.select().from(digests).where(eq(digests.id, digestId)).limit(1);
  const digestRow = digestRows[0];
  if (!digestRow) return null;

  const itemRows = (await db
    .select()
    .from(items)
    .where(eq(items.digestId, digestId))
    .orderBy(desc(items.score))) as unknown as DigestItem[];

  let brainFact: { text: string; topic: string | null } | null = null;
  if (digestRow.brainFactId) {
    const factRows = await db
      .select()
      .from(brainFacts)
      .where(eq(brainFacts.id, digestRow.brainFactId))
      .limit(1);
    if (factRows[0]) brainFact = { text: factRows[0].text, topic: factRows[0].topic };
  }

  return {
    id: digestRow.id,
    periodLabel: digestRow.periodLabel,
    frequency: digestRow.frequency,
    createdAt: digestRow.createdAt,
    brainFact,
    itemsByCategory: groupByCategory(itemRows),
    totalItems: itemRows.length,
  };
}

/** The most recently compiled digest, or null if none exist yet. */
export async function getLatestDigest(): Promise<DigestView | null> {
  const latest = await db.select().from(digests).orderBy(desc(digests.id)).limit(1);
  if (!latest[0]) return null;
  return loadDigest(latest[0].id);
}

export async function getDigestById(id: number): Promise<DigestView | null> {
  return loadDigest(id);
}

export interface DigestListEntry {
  id: number;
  periodLabel: string;
  frequency: string;
  createdAt: string;
  itemCount: number;
}

/** All digests, newest first, for the Archive view. */
export async function listDigests(): Promise<DigestListEntry[]> {
  const rows = await db.select().from(digests).orderBy(desc(digests.id));
  const withCounts: DigestListEntry[] = [];
  for (const d of rows) {
    const itemRows = await db.select({ id: items.id }).from(items).where(eq(items.digestId, d.id));
    withCounts.push({
      id: d.id,
      periodLabel: d.periodLabel,
      frequency: d.frequency,
      createdAt: d.createdAt,
      itemCount: itemRows.length,
    });
  }
  return withCounts;
}

export interface AppSettings {
  frequency: "daily" | "weekly";
  mutedCategories: Category[];
  lastRefreshAt: string | null;
}

export async function getAppSettings(): Promise<AppSettings> {
  const rows = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  const row = rows[0];
  return {
    frequency: (row?.frequency as "daily" | "weekly") ?? "daily",
    mutedCategories: row?.mutedCategories ? (JSON.parse(row.mutedCategories) as Category[]) : [],
    lastRefreshAt: row?.lastRefreshAt ?? null,
  };
}

export async function updateAppSettings(update: {
  frequency?: "daily" | "weekly";
  mutedCategories?: Category[];
}) {
  const patch: Record<string, unknown> = {};
  if (update.frequency) patch.frequency = update.frequency;
  if (update.mutedCategories) patch.mutedCategories = JSON.stringify(update.mutedCategories);
  await db.update(settings).set(patch).where(eq(settings.id, 1));
}

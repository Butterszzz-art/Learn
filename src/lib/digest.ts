import { db } from "@/db";
import { digests, items, brainFacts, settings, deepDives, interests } from "@/db/schema";
import type { Category, Level } from "@/db/schema";
import { eq, desc, inArray } from "drizzle-orm";

export interface FeedCuratedEntry {
  type: "curated";
  id: number;
  title: string;
  authors: string | null;
  summary: string;
  sourceName: string;
  sourceType: string;
  category: Category | null;
  url: string;
  publishedAt: string | null;
  interestName: string;
  interestSlug: string;
  score: number;
}

export interface FeedDeepDiveEntry {
  type: "deepdive";
  id: number;
  topic: string;
  contentPreview: string;
  level: Level;
  interestName: string;
  interestSlug: string;
  createdAt: string;
  sourceCount: number;
}

export type FeedEntry = FeedCuratedEntry | FeedDeepDiveEntry;

export interface CycleFeed {
  cycleId: number;
  periodLabel: string;
  frequency: string;
  createdAt: string;
  brainFact: { text: string; topic: string | null } | null;
  showBrainFact: boolean;
  entries: FeedEntry[];
}

function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function previewOf(md: string, max = 220): string {
  const plain = stripMarkdown(md);
  if (plain.length <= max) return plain;
  return plain.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

/**
 * Builds the merged, bounded feed for one cycle, restricted to the given
 * interest ids (the enabled set at read time — an interest disabled after a
 * cycle was compiled simply drops out of view, without deleting anything).
 * Deep dives sort first (most substantial), then curated items by score.
 */
async function loadCycleFeed(cycleId: number, enabledInterestIds: number[]): Promise<CycleFeed | null> {
  const cycleRows = await db.select().from(digests).where(eq(digests.id, cycleId)).limit(1);
  const cycle = cycleRows[0];
  if (!cycle) return null;

  if (enabledInterestIds.length === 0) {
    return {
      cycleId: cycle.id,
      periodLabel: cycle.periodLabel,
      frequency: cycle.frequency,
      createdAt: cycle.createdAt,
      brainFact: null,
      showBrainFact: false,
      entries: [],
    };
  }

  const allInterests = await db.select().from(interests);
  const interestById = new Map(allInterests.map((i) => [i.id, i]));

  const itemRows = await db
    .select()
    .from(items)
    .where(eq(items.digestId, cycleId));
  const diveRows = await db
    .select()
    .from(deepDives)
    .where(eq(deepDives.digestId, cycleId));

  const enabledSet = new Set(enabledInterestIds);

  const curatedEntries: FeedCuratedEntry[] = itemRows
    .filter((r) => r.interestId != null && enabledSet.has(r.interestId))
    .map((r) => {
      const interest = interestById.get(r.interestId!);
      return {
        type: "curated",
        id: r.id,
        title: r.title,
        authors: r.authors,
        summary: r.summary,
        sourceName: r.sourceName,
        sourceType: r.sourceType,
        category: r.category,
        url: r.url,
        publishedAt: r.publishedAt,
        interestName: interest?.name ?? "Unknown",
        interestSlug: interest?.slug ?? "unknown",
        score: r.score,
      };
    });

  const deepDiveEntries: FeedDeepDiveEntry[] = diveRows
    .filter((r) => enabledSet.has(r.interestId))
    .map((r) => {
      const interest = interestById.get(r.interestId);
      let sourceCount = 0;
      try {
        sourceCount = (JSON.parse(r.sources) as unknown[]).length;
      } catch {
        sourceCount = 0;
      }
      return {
        type: "deepdive",
        id: r.id,
        topic: r.topic,
        contentPreview: previewOf(r.content),
        level: r.level,
        interestName: interest?.name ?? "Unknown",
        interestSlug: interest?.slug ?? "unknown",
        createdAt: r.createdAt,
        sourceCount,
      };
    });

  curatedEntries.sort((a, b) => b.score - a.score);
  deepDiveEntries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  let brainFact: { text: string; topic: string | null } | null = null;
  if (cycle.brainFactId) {
    const factRows = await db.select().from(brainFacts).where(eq(brainFacts.id, cycle.brainFactId)).limit(1);
    if (factRows[0]) brainFact = { text: factRows[0].text, topic: factRows[0].topic };
  }
  const neuroInterest = allInterests.find((i) => i.slug === "neuroscience");
  const showBrainFact = !!neuroInterest && enabledSet.has(neuroInterest.id);

  return {
    cycleId: cycle.id,
    periodLabel: cycle.periodLabel,
    frequency: cycle.frequency,
    createdAt: cycle.createdAt,
    brainFact,
    showBrainFact,
    entries: [...deepDiveEntries, ...curatedEntries],
  };
}

/** The current (most recent) cycle's feed, restricted to enabled interests. */
export async function getCurrentFeed(enabledInterestIds: number[]): Promise<CycleFeed | null> {
  const latest = await db.select().from(digests).orderBy(desc(digests.id)).limit(1);
  if (!latest[0]) return null;
  return loadCycleFeed(latest[0].id, enabledInterestIds);
}

export async function getFeedByCycleId(
  cycleId: number,
  enabledInterestIds: number[]
): Promise<CycleFeed | null> {
  return loadCycleFeed(cycleId, enabledInterestIds);
}

export interface CycleListEntry {
  id: number;
  periodLabel: string;
  frequency: string;
  createdAt: string;
  curatedCount: number;
  deepDiveCount: number;
}

/** All cycles, newest first, for the Archive view. */
export async function listCycles(): Promise<CycleListEntry[]> {
  const rows = await db.select().from(digests).orderBy(desc(digests.id));
  const out: CycleListEntry[] = [];
  for (const d of rows) {
    const itemRows = await db.select({ id: items.id }).from(items).where(eq(items.digestId, d.id));
    const diveRows = await db.select({ id: deepDives.id }).from(deepDives).where(eq(deepDives.digestId, d.id));
    out.push({
      id: d.id,
      periodLabel: d.periodLabel,
      frequency: d.frequency,
      createdAt: d.createdAt,
      curatedCount: itemRows.length,
      deepDiveCount: diveRows.length,
    });
  }
  return out;
}

export interface DeepDiveDetail {
  id: number;
  topic: string;
  content: string;
  sources: { title: string; url: string }[];
  level: Level;
  interestName: string;
  interestSlug: string;
  createdAt: string;
}

export async function getDeepDiveById(id: number): Promise<DeepDiveDetail | null> {
  const rows = await db.select().from(deepDives).where(eq(deepDives.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  const interestRows = await db.select().from(interests).where(eq(interests.id, row.interestId)).limit(1);
  const interest = interestRows[0];
  let sources: { title: string; url: string }[] = [];
  try {
    sources = JSON.parse(row.sources);
  } catch {
    sources = [];
  }
  return {
    id: row.id,
    topic: row.topic,
    content: row.content,
    sources,
    level: row.level,
    interestName: interest?.name ?? "Unknown",
    interestSlug: interest?.slug ?? "unknown",
    createdAt: row.createdAt,
  };
}

export interface AppSettings {
  frequency: "daily" | "weekly";
  lastRefreshAt: string | null;
}

export async function getAppSettings(): Promise<AppSettings> {
  const rows = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  const row = rows[0];
  return {
    frequency: (row?.frequency as "daily" | "weekly") ?? "daily",
    lastRefreshAt: row?.lastRefreshAt ?? null,
  };
}

export async function updateAppSettings(update: { frequency?: "daily" | "weekly" }) {
  const patch: Record<string, unknown> = {};
  if (update.frequency) patch.frequency = update.frequency;
  if (Object.keys(patch).length === 0) return;
  await db.update(settings).set(patch).where(eq(settings.id, 1));
}

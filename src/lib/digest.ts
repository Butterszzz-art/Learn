import { db } from "@/db";
import { digests, items, brainFacts, settings, deepDives, appliedInsights, interests } from "@/db/schema";
import type { Category, Level } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export interface NewsItem {
  id: number;
  title: string;
  authors: string | null;
  summary: string;
  sourceName: string;
  sourceType: string; // "academic" | "journalism" | "generated"
  category: Category | null;
  url: string;
  publishedAt: string | null;
  score: number;
}

export interface DeepDiveSummary {
  id: number;
  topic: string;
  contentPreview: string;
  level: Level;
  createdAt: string;
  sourceCount: number;
}

export interface AppliedInsightSummary {
  id: number;
  content: string;
  createdAt: string;
}

export interface InterestFeedSection {
  interestId: number;
  interestName: string;
  interestSlug: string;
  news: NewsItem[];
  deepDive: DeepDiveSummary | null;
  appliedInsight: AppliedInsightSummary | null;
}

export interface CycleFeed {
  cycleId: number;
  periodLabel: string;
  frequency: string;
  createdAt: string;
  brainFact: { text: string; topic: string | null } | null;
  showBrainFact: boolean;
  sections: InterestFeedSection[];
  totalEntries: number;
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
 * Builds the bounded feed for one cycle, restricted to the given interest
 * ids (the enabled set at read time — an interest disabled after a cycle
 * was compiled simply drops out of view, without deleting anything).
 * Grouped by interest; within each interest, News / Deep Dive / Applied
 * Insight are clearly separate sections (Phase 3).
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
      sections: [],
      totalEntries: 0,
    };
  }

  const allInterests = await db.select().from(interests);
  const interestById = new Map(allInterests.map((i) => [i.id, i]));
  const enabledSet = new Set(enabledInterestIds);

  const itemRows = await db.select().from(items).where(eq(items.digestId, cycleId));
  const diveRows = await db.select().from(deepDives).where(eq(deepDives.digestId, cycleId));
  const insightRows = await db
    .select({ insight: appliedInsights, dive: deepDives })
    .from(appliedInsights)
    .innerJoin(deepDives, eq(appliedInsights.deepDiveId, deepDives.id))
    .where(eq(deepDives.digestId, cycleId));

  const sectionsById = new Map<number, InterestFeedSection>();
  function getSection(interestId: number): InterestFeedSection | null {
    if (!enabledSet.has(interestId)) return null;
    let section = sectionsById.get(interestId);
    if (!section) {
      const interest = interestById.get(interestId);
      section = {
        interestId,
        interestName: interest?.name ?? "Unknown",
        interestSlug: interest?.slug ?? "unknown",
        news: [],
        deepDive: null,
        appliedInsight: null,
      };
      sectionsById.set(interestId, section);
    }
    return section;
  }

  for (const r of itemRows) {
    if (r.interestId == null) continue;
    const section = getSection(r.interestId);
    if (!section) continue;
    section.news.push({
      id: r.id,
      title: r.title,
      authors: r.authors,
      summary: r.summary,
      sourceName: r.sourceName,
      sourceType: r.sourceType,
      category: r.category,
      url: r.url,
      publishedAt: r.publishedAt,
      score: r.score,
    });
  }

  for (const r of diveRows) {
    const section = getSection(r.interestId);
    if (!section) continue;
    let sourceCount = 0;
    try {
      sourceCount = (JSON.parse(r.sources) as unknown[]).length;
    } catch {
      sourceCount = 0;
    }
    section.deepDive = {
      id: r.id,
      topic: r.topic,
      contentPreview: previewOf(r.content),
      level: r.level,
      createdAt: r.createdAt,
      sourceCount,
    };
  }

  for (const { insight, dive } of insightRows) {
    const section = getSection(dive.interestId);
    if (!section) continue;
    section.appliedInsight = { id: insight.id, content: insight.content, createdAt: insight.createdAt };
  }

  for (const section of sectionsById.values()) {
    section.news.sort((a, b) => b.score - a.score);
  }

  // Stable order: interest creation order (roughly onboarding order).
  const sections = allInterests
    .filter((i) => sectionsById.has(i.id))
    .map((i) => sectionsById.get(i.id)!);

  const totalEntries = sections.reduce(
    (sum, s) => sum + s.news.length + (s.deepDive ? 1 : 0) + (s.appliedInsight ? 1 : 0),
    0
  );

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
    sections,
    totalEntries,
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
  newsCount: number;
  deepDiveCount: number;
  insightCount: number;
}

/** All cycles, newest first, for the Archive view. */
export async function listCycles(): Promise<CycleListEntry[]> {
  const rows = await db.select().from(digests).orderBy(desc(digests.id));
  const out: CycleListEntry[] = [];
  for (const d of rows) {
    const itemRows = await db.select({ id: items.id }).from(items).where(eq(items.digestId, d.id));
    const diveRows = await db.select({ id: deepDives.id }).from(deepDives).where(eq(deepDives.digestId, d.id));
    const insightRows = await db
      .select({ id: appliedInsights.id })
      .from(appliedInsights)
      .innerJoin(deepDives, eq(appliedInsights.deepDiveId, deepDives.id))
      .where(eq(deepDives.digestId, d.id));
    out.push({
      id: d.id,
      periodLabel: d.periodLabel,
      frequency: d.frequency,
      createdAt: d.createdAt,
      newsCount: itemRows.length,
      deepDiveCount: diveRows.length,
      insightCount: insightRows.length,
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
  appliedInsight: string | null;
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
  const insightRows = await db
    .select({ content: appliedInsights.content })
    .from(appliedInsights)
    .where(eq(appliedInsights.deepDiveId, id))
    .limit(1);

  return {
    id: row.id,
    topic: row.topic,
    content: row.content,
    sources,
    level: row.level,
    interestName: interest?.name ?? "Unknown",
    interestSlug: interest?.slug ?? "unknown",
    createdAt: row.createdAt,
    appliedInsight: insightRows[0]?.content ?? null,
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

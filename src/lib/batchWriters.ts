// Phase 14 (Cost Optimization) — the write side of the batch queue: given a
// completed batchRequests row (contentType + payload + the model's result
// text), parses the result and persists it into the normal content tables,
// exactly as if it had been generated synchronously. Round-a writers return
// enough about what they created for scripts/processBatches.ts to assemble
// round-b requests from; round-b writers are terminal.
import { db } from "@/db";
import { deepDives, items, drills, appliedInsights, rabbitHoles, modelUsage } from "@/db/schema";
import type { Level } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { CompletedBatchRequest } from "./batch";
import { addCoveredTopic } from "./interests";
import { indexForSearch } from "./searchIndex";
import { dedupeKeyFor } from "./dedupe";
import type { RawItem } from "./types";
import {
  parseClassifyChunkResult,
  parseSummarizeChunkResult,
} from "./claude";
import { categorizeByKeywords } from "./categorize";
import { insertItems, cleanSummary } from "./pipeline";
import { parseDeepDiveWriteResult, parseAppliedInsightResult, parseFollowUpTopicsResult, parseSelfCheckResult } from "./deepDive";
import { toRawItems as roundupToRawItems, parseFieldNewsWriteResult } from "./newsRoundup";
import { parseRabbitHoleWriteResult } from "./rabbitHole";
import { parseDrillResponse, type DrillGenResult } from "./drills";
import { parseEssayPromptResult } from "./explainBack";
import { parseMentalModelLensResult, type LensCandidateItem } from "./mentalModelLens";
import { parseSteelmanWriteResult } from "./steelman";
import { scoreItem } from "./score";
import type { SyllabusComparison } from "./syllabus";

// ---------------------------------------------------------------------------
// Round A — independent generation, no dependency on this same submission
// round's other results.
// ---------------------------------------------------------------------------

export interface NewsCuratedPayload {
  interestId: number;
  interestName: string;
  cycleId: number;
  isNeuro: boolean;
  items: (RawItem & { score: number })[];
}

export interface NewsRoundupPayload {
  interestId: number;
  interestName: string;
  cycleId: number;
  items: { title: string; date?: string; source: string; url: string; notes: string }[];
}

export interface DeepDiveWritePayload {
  interestId: number;
  interestName: string;
  cycleId: number;
  level: Level;
  topic: string;
  sources: { title: string; url: string }[];
  // Phase 15 (Syllabus Awareness) — computed at queue time (see
  // submitBatch.ts), since it's derived from the gathered topic + the
  // interest's attached syllabi, both already known by then.
  syllabusComparison: SyllabusComparison | null;
}

export interface RabbitHoleWritePayload {
  cycleId: number;
  title: string;
  topicArea: string;
  sourceName: string;
  url: string;
}

export interface StandaloneDrillPayload {
  cycleId: number;
  interestId: number;
  interestName: string;
  generatesAppliedInsights: boolean;
}

export interface WrittenDeepDive {
  deepDiveId: number;
  interestId: number;
  interestName: string;
  level: Level;
  topic: string;
  content: string;
  cycleId: number;
}

export interface WrittenDrill {
  drillId: number;
  interestId: number;
  interestName: string;
  cycleId: number;
  generatesAppliedInsights: boolean;
}

export interface RoundAOutcome {
  deepDive?: WrittenDeepDive;
  drill?: WrittenDrill;
}

/** Dispatches one round-a batch result to the right writer. Returns
 * whatever the caller (scripts/processBatches.ts) needs to assemble round-b
 * requests — undefined fields for content types round-b doesn't build on. */
export async function applyRoundAResult(result: CompletedBatchRequest): Promise<RoundAOutcome> {
  if (!result.ok || !result.text) return {};
  try {
    switch (result.contentType) {
      case "news_curated": {
        const payload = result.payload as NewsCuratedPayload;
        const map = payload.isNeuro ? parseClassifyChunkResult(result.text) : null;
        const summaryMap = payload.isNeuro ? null : parseSummarizeChunkResult(result.text);
        const processed = payload.items.map((item, idx) => {
          let category = null as any;
          let summary: string;
          if (map) {
            const r = map.get(idx);
            category = r?.category ?? categorizeByKeywords(item);
            summary = cleanSummary(r?.summary, item.snippet);
          } else {
            summary = cleanSummary(summaryMap?.get(idx), item.snippet);
          }
          return { ...item, category, summary, dedupeKey: dedupeKeyFor(item) };
        });
        await insertItems(processed, payload.interestId, payload.interestName, payload.cycleId);
        return {};
      }

      case "news_roundup": {
        const payload = result.payload as NewsRoundupPayload;
        const summaries = parseFieldNewsWriteResult(result.text);
        const rawItems = roundupToRawItems(payload.items, summaries);
        const processed = rawItems.map((item) => ({
          ...item,
          category: null,
          summary: item.snippet,
          score: scoreItem(item),
          dedupeKey: dedupeKeyFor(item),
        }));
        processed.sort((a, b) => b.score - a.score);
        await insertItems(processed.slice(0, 5), payload.interestId, payload.interestName, payload.cycleId);
        return {};
      }

      case "deep_dive_write": {
        const payload = result.payload as DeepDiveWritePayload;
        const content = parseDeepDiveWriteResult(result.text);
        if (!content) return {};
        const inserted = await db
          .insert(deepDives)
          .values({
            interestId: payload.interestId,
            topic: payload.topic,
            content,
            sources: JSON.stringify(payload.sources),
            level: payload.level,
            digestId: payload.cycleId,
            syllabusComparison: payload.syllabusComparison ? JSON.stringify(payload.syllabusComparison) : null,
          })
          .returning({ id: deepDives.id });
        const deepDiveId = inserted[0].id;
        await addCoveredTopic(payload.interestId, payload.topic, deepDiveId);
        indexForSearch({
          contentType: "deep_dive",
          sourceId: deepDiveId,
          title: payload.topic,
          body: content,
          interestLabel: payload.interestName,
          interestId: payload.interestId,
          date: new Date().toISOString(),
          url: `/deep-dive/${deepDiveId}`,
        }).catch((err) => console.error("[batchWriters] search-index failed for batched deep dive:", err));
        return {
          deepDive: {
            deepDiveId,
            interestId: payload.interestId,
            interestName: payload.interestName,
            level: payload.level,
            topic: payload.topic,
            content,
            cycleId: payload.cycleId,
          },
        };
      }

      case "rabbit_hole_write": {
        const payload = result.payload as RabbitHoleWritePayload;
        const summary = parseRabbitHoleWriteResult(result.text);
        if (!summary) return {};
        const inserted = await db
          .insert(rabbitHoles)
          .values({
            title: payload.title,
            summary,
            url: payload.url,
            sourceName: payload.sourceName,
            topicArea: payload.topicArea,
            digestId: payload.cycleId,
          })
          .returning({ id: rabbitHoles.id });
        indexForSearch({
          contentType: "rabbit_hole",
          sourceId: inserted[0].id,
          title: payload.title,
          body: summary,
          interestLabel: payload.topicArea,
          interestId: null,
          date: new Date().toISOString(),
          url: `/archive/${payload.cycleId}?at=rabbithole-${inserted[0].id}`,
        }).catch((err) => console.error("[batchWriters] search-index failed for batched rabbit hole:", err));
        return {};
      }

      case "standalone_drill": {
        const payload = result.payload as StandaloneDrillPayload;
        const parsed = parseDrillResponse(result.text) as DrillGenResult | null;
        if (!parsed) return {};
        const inserted = await db
          .insert(drills)
          .values({
            interestId: payload.interestId,
            sourceDeepDiveId: null,
            drillType: parsed.drillType,
            promptContent: parsed.promptContent,
            options: JSON.stringify(parsed.options),
            correctOption: parsed.correctOption,
            explanation: parsed.explanation,
            conceptLabel: parsed.conceptLabel,
            digestId: payload.cycleId,
          })
          .returning({ id: drills.id });
        await addCoveredTopic(payload.interestId, parsed.conceptLabel, null);
        indexForSearch({
          contentType: "drill",
          sourceId: inserted[0].id,
          title: `Drill — ${parsed.conceptLabel}`,
          body: `${parsed.promptContent}\n\n${parsed.explanation}`,
          interestLabel: payload.interestName,
          interestId: payload.interestId,
          date: new Date().toISOString(),
          url: "/drills",
        }).catch((err) => console.error("[batchWriters] search-index failed for batched standalone drill:", err));
        return {
          drill: {
            drillId: inserted[0].id,
            interestId: payload.interestId,
            interestName: payload.interestName,
            cycleId: payload.cycleId,
            generatesAppliedInsights: payload.generatesAppliedInsights,
          },
        };
      }

      default:
        console.error(`[batchWriters] Unknown round-a contentType "${result.contentType}" for request #${result.requestId}`);
        return {};
    }
  } catch (err) {
    console.error(`[batchWriters] Round-a writer failed for request #${result.requestId} (${result.contentType}):`, err);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Round B — derived generation, built on round-a's newly-written content.
// Terminal: nothing further chains off these.
// ---------------------------------------------------------------------------

export interface AppliedInsightFromDivePayload {
  interestId: number;
  interestName: string;
  deepDiveId: number;
}

export interface GroundedDrillPayload {
  interestId: number;
  interestName: string;
  cycleId: number;
  deepDiveId: number;
}

export interface DeepDiveExtraPayload {
  deepDiveId: number;
  kind: "follow_up_topics" | "self_check" | "essay_prompt";
}

export interface MentalModelLensPayload {
  modelId: number;
  cycleId: number;
  candidates: (LensCandidateItem & { ref: { type: "item" | "chapter"; id: number } })[];
}

export interface SteelmanWritePayload {
  itemIdByIndex: Record<number, number>; // candidate index -> items.id
}

export async function applyRoundBResult(result: CompletedBatchRequest): Promise<void> {
  if (!result.ok || !result.text) return;
  try {
    switch (result.contentType) {
      case "applied_insight": {
        const payload = result.payload as AppliedInsightFromDivePayload;
        const content = parseAppliedInsightResult(result.text);
        if (!content) return;
        const inserted = await db
          .insert(appliedInsights)
          .values({ interestId: payload.interestId, deepDiveId: payload.deepDiveId, content })
          .returning({ id: appliedInsights.id });
        indexForSearch({
          contentType: "applied_insight",
          sourceId: inserted[0].id,
          title: `Applied Insight — ${payload.interestName}`,
          body: content,
          interestLabel: payload.interestName,
          interestId: payload.interestId,
          date: new Date().toISOString(),
          url: `/deep-dive/${payload.deepDiveId}`,
        }).catch((err) => console.error("[batchWriters] search-index failed for batched applied insight:", err));
        return;
      }

      case "grounded_drill": {
        const payload = result.payload as GroundedDrillPayload;
        const parsed = parseDrillResponse(result.text) as DrillGenResult | null;
        if (!parsed) return;
        const inserted = await db
          .insert(drills)
          .values({
            interestId: payload.interestId,
            sourceDeepDiveId: payload.deepDiveId,
            drillType: parsed.drillType,
            promptContent: parsed.promptContent,
            options: JSON.stringify(parsed.options),
            correctOption: parsed.correctOption,
            explanation: parsed.explanation,
            conceptLabel: parsed.conceptLabel,
            digestId: payload.cycleId,
          })
          .returning({ id: drills.id });
        await addCoveredTopic(payload.interestId, parsed.conceptLabel, payload.deepDiveId);
        indexForSearch({
          contentType: "drill",
          sourceId: inserted[0].id,
          title: `Drill — ${parsed.conceptLabel}`,
          body: `${parsed.promptContent}\n\n${parsed.explanation}`,
          interestLabel: payload.interestName,
          interestId: payload.interestId,
          date: new Date().toISOString(),
          url: "/drills",
        }).catch((err) => console.error("[batchWriters] search-index failed for batched grounded drill:", err));
        // Note (Phase 14 scope): unlike the synchronous path, a batched
        // grounded drill doesn't chase a further Applied-Insight-from-drill
        // call — that would need a round-c. Interests whose primary content
        // IS drills (e.g. Critical Thinking) still get one via the manual
        // "Refresh now" / "Generate now" paths, which use the full
        // synchronous chain.
        return;
      }

      case "follow_up_topics": {
        const payload = result.payload as DeepDiveExtraPayload;
        const followUps = parseFollowUpTopicsResult(result.text);
        await db.update(deepDives).set({ followUpTopics: JSON.stringify(followUps) }).where(eq(deepDives.id, payload.deepDiveId));
        return;
      }

      case "self_check": {
        const payload = result.payload as DeepDiveExtraPayload;
        const questions = parseSelfCheckResult(result.text);
        await db.update(deepDives).set({ selfCheckQuestions: JSON.stringify(questions) }).where(eq(deepDives.id, payload.deepDiveId));
        return;
      }

      case "essay_prompt": {
        const payload = result.payload as DeepDiveExtraPayload;
        const prompt = parseEssayPromptResult(result.text);
        if (!prompt) return;
        await db.update(deepDives).set({ essayPrompt: prompt }).where(eq(deepDives.id, payload.deepDiveId));
        return;
      }

      case "mental_model_lens": {
        const payload = result.payload as MentalModelLensPayload;
        const lens = parseMentalModelLensResult(result.text, payload.candidates);
        if (!lens) return;
        const linkedItemIds = lens.usedIndexes
          .map((i) => payload.candidates.find((c) => c.index === i)?.ref)
          .filter((ref): ref is { type: "item" | "chapter"; id: number } => ref != null);
        if (linkedItemIds.length === 0) return;
        const inserted = await db
          .insert(modelUsage)
          .values({ modelId: payload.modelId, digestId: payload.cycleId, linkedItemIds: JSON.stringify(linkedItemIds), lensText: lens.lensText })
          .returning({ id: modelUsage.id });
        indexForSearch({
          contentType: "mental_model",
          sourceId: inserted[0].id,
          title: "Mental Model of the Week",
          body: lens.lensText,
          interestLabel: "Mental Model of the Week",
          interestId: null,
          date: new Date().toISOString(),
          url: `/archive/${payload.cycleId}?at=mentalmodel-${inserted[0].id}`,
        }).catch((err) => console.error("[batchWriters] search-index failed for batched mental model lens:", err));
        return;
      }

      case "steelman_write": {
        const payload = result.payload as SteelmanWritePayload;
        const parsed = parseSteelmanWriteResult(result.text);
        for (const r of parsed) {
          const itemId = payload.itemIdByIndex[r.index];
          if (!itemId) continue;
          await db.update(items).set({ steelmanContent: r.steelman }).where(eq(items.id, itemId));
        }
        return;
      }

      default:
        console.error(`[batchWriters] Unknown round-b contentType "${result.contentType}" for request #${result.requestId}`);
    }
  } catch (err) {
    console.error(`[batchWriters] Round-b writer failed for request #${result.requestId} (${result.contentType}):`, err);
  }
}

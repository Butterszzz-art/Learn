// Phase 14 (Cost Optimization) — round-a batch submission. Run this on a
// schedule with enough lead time before the cycle is meant to be ready:
// batches can take up to 24 hours, so for a Monday release, trigger the
// weekly run Saturday evening; for the next day's daily News, trigger the
// daily run the evening before. Don't cut it closer than that — content
// simply won't be ready in time for the cycle it's meant to open.
//
// This script does the SYNCHRONOUS half of every batch-eligible content
// type (fetching, web-search gathering) and queues the no-tools WRITE half
// as one Anthropic Message Batch. scripts/processBatches.ts (run
// frequently, on its own short cycle) polls for completion, writes the
// results back, and — for round-a jobs — automatically assembles and
// submits round-b (Applied Insights, grounded Drills, follow-ups/self-
// check, Mental Model lens, Steelman) once round-a's content has landed.
//
// Usage: npm run submit-batch
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { ensureDb } from "../src/db/bootstrap";
import { db } from "../src/db";
import { deepDives, drills, rabbitHoles, bumpLevel } from "../src/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import {
  getOrCreateDailyCycleId,
  getOrCreateWeeklyCycleId,
  filterFresh,
  buildSummaryTexts,
  TARGET_ITEMS_PER_INTEREST,
  WEEKLY_DEEP_DIVE_QUOTA_NORMAL,
  WEEKLY_DEEP_DIVE_QUOTA_FAVORITE,
  RABBIT_HOLE_WEEKLY_TARGET,
  RABBIT_HOLE_AVOID_LOOKBACK,
  ROUNDUP_FOCUS_OVERRIDES,
} from "../src/lib/pipeline";
import { getEnabledInterests, getInterestBySlug, getCoveredTopics } from "../src/lib/interests";
import { getSyllabusContext, computeSyllabusComparison } from "../src/lib/syllabus";
import { fetchForInterest } from "../src/lib/fetchers/registry";
import { scoreItem } from "../src/lib/score";
import { buildClassifyChunkParams, buildSummarizeChunkParams, BATCH_SIZE, hasClaudeKey } from "../src/lib/claude";
import { gatherDeepDiveMaterial, buildDeepDiveWriteParams } from "../src/lib/deepDive";
import { gatherFieldNews, buildFieldNewsWriteParams } from "../src/lib/newsRoundup";
import { gatherRabbitHoleMaterial, buildRabbitHoleWriteParams } from "../src/lib/rabbitHole";
import { buildStandaloneLogicDrillParams } from "../src/lib/drills";
import { isAutoGenerationEnabled, runPruningSweep } from "../src/lib/engagement";
import { submitBatch, type QueuedBatchRequest } from "../src/lib/batch";

async function main() {
  await ensureDb();
  if (!hasClaudeKey()) {
    console.log("No ANTHROPIC_API_KEY set — nothing to submit.");
    return;
  }

  const flipped = await runPruningSweep();
  if (flipped.length > 0) {
    console.log(`[submitBatch] Pruning sweep switched ${flipped.length} (interest, content type) combination(s) to on-demand.`);
  }

  const dailyCycleId = await getOrCreateDailyCycleId();
  const weeklyCycleId = await getOrCreateWeeklyCycleId();
  const enabledInterests = await getEnabledInterests();

  const requests: QueuedBatchRequest[] = [];

  for (const interest of enabledInterests) {
    // --- News ---
    if (await isAutoGenerationEnabled(interest.id, "news")) {
      if (interest.hasCuratedSource) {
        try {
          const rawItems = await fetchForInterest(interest.slug);
          const fresh = await filterFresh(rawItems);
          const candidates = fresh
            .map((item) => ({ item, score: scoreItem(item) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, TARGET_ITEMS_PER_INTEREST);
          if (candidates.length > 0) {
            const isNeuro = interest.slug === "neuroscience";
            const chosenItems = candidates.map((c) => c.item);
            const summaryTexts = await buildSummaryTexts(chosenItems);
            const itemsForSummary = chosenItems.map((item, i) => ({ ...item, snippet: summaryTexts[i] }));
            const scoredItems = candidates.map((c, i) => ({ ...chosenItems[i], score: c.score }));
            for (let offset = 0; offset < itemsForSummary.length; offset += BATCH_SIZE) {
              const chunk = itemsForSummary.slice(offset, offset + BATCH_SIZE);
              const scoredChunk = scoredItems.slice(offset, offset + BATCH_SIZE);
              const params = isNeuro ? buildClassifyChunkParams(chunk) : buildSummarizeChunkParams(chunk);
              requests.push({
                contentType: "news_curated",
                payload: { interestId: interest.id, interestName: interest.name, cycleId: dailyCycleId, isNeuro, items: scoredChunk },
                params,
              });
            }
          }
        } catch (err) {
          console.error(`[submitBatch] Curated News gathering failed for "${interest.name}":`, err);
        }
      } else {
        try {
          const gathered = await gatherFieldNews(interest.name, ROUNDUP_FOCUS_OVERRIDES[interest.slug]);
          if (gathered.length > 0) {
            requests.push({
              contentType: "news_roundup",
              payload: { interestId: interest.id, interestName: interest.name, cycleId: dailyCycleId, items: gathered },
              params: buildFieldNewsWriteParams(gathered),
            });
          }
        } catch (err) {
          console.error(`[submitBatch] Field News Roundup gathering failed for "${interest.name}":`, err);
        }
      }
    }

    // --- Deep Dive(s) ---
    if (interest.slug !== "critical-thinking" && (await isAutoGenerationEnabled(interest.id, "deep_dive"))) {
      try {
        const quota = interest.isFavorite ? WEEKLY_DEEP_DIVE_QUOTA_FAVORITE : WEEKLY_DEEP_DIVE_QUOTA_NORMAL;
        const existing = await db
          .select({ id: deepDives.id })
          .from(deepDives)
          .where(and(eq(deepDives.interestId, interest.id), eq(deepDives.digestId, weeklyCycleId)));
        const needed = quota - existing.length;
        if (needed > 0) {
          const covered = await getCoveredTopics(interest.id);
          const level = interest.isFavorite ? bumpLevel(interest.level) : interest.level;
          // Phase 15 (Syllabus Awareness) — same context for every dive
          // queued this round for this interest; empty array for an
          // interest with no attached syllabus.
          const syllabusContext = await getSyllabusContext(interest.id);
          // In-memory only: subsequent gather calls within this same
          // submission round need to know about topics picked earlier in
          // THIS run (a favorited interest can queue several dives at
          // once), even though they won't hit covered_topics until their
          // write step lands — see addCoveredTopic in batchWriters.ts.
          const localRecent = [...covered.recent];
          let localTotal = covered.totalCount;
          for (let i = 0; i < needed; i++) {
            const gathered = await gatherDeepDiveMaterial(
              interest.name,
              level,
              { recent: localRecent, totalCount: localTotal },
              undefined,
              syllabusContext
            );
            if (!gathered) break;
            const coveredForWrite = { recent: localRecent, totalCount: localTotal };
            const syllabusComparison = computeSyllabusComparison(gathered.topic, syllabusContext);
            requests.push({
              contentType: "deep_dive_write",
              payload: {
                interestId: interest.id,
                interestName: interest.name,
                cycleId: weeklyCycleId,
                level,
                topic: gathered.topic,
                sources: gathered.sources,
                syllabusComparison,
              },
              params: buildDeepDiveWriteParams(interest.name, level, coveredForWrite, gathered, syllabusComparison),
            });
            localRecent.push(gathered.topic);
            localTotal++;
          }
        }
      } catch (err) {
        console.error(`[submitBatch] Deep Dive gathering failed for "${interest.name}":`, err);
      }
    }
  }

  // --- Standalone logic drill (cycle-level, at most one target interest) ---
  try {
    const [criticalThinking, logic] = await Promise.all([getInterestBySlug("critical-thinking"), getInterestBySlug("logic")]);
    const targetInterest = criticalThinking?.enabled ? criticalThinking : logic?.enabled ? logic : null;
    if (targetInterest && (await isAutoGenerationEnabled(targetInterest.id, "drill"))) {
      const existingStandalone = await db
        .select({ id: drills.id })
        .from(drills)
        .where(and(eq(drills.digestId, weeklyCycleId), isNull(drills.sourceDeepDiveId)));
      if (existingStandalone.length === 0) {
        const [ctCovered, logicCovered] = await Promise.all([
          criticalThinking ? getCoveredTopics(criticalThinking.id) : null,
          logic ? getCoveredTopics(logic.id) : null,
        ]);
        const avoidConcepts = [...(ctCovered?.recent ?? []), ...(logicCovered?.recent ?? [])];
        requests.push({
          contentType: "standalone_drill",
          payload: {
            cycleId: weeklyCycleId,
            interestId: targetInterest.id,
            interestName: targetInterest.name,
            generatesAppliedInsights: targetInterest.generatesAppliedInsights,
          },
          params: buildStandaloneLogicDrillParams(avoidConcepts),
        });
      }
    }
  } catch (err) {
    console.error("[submitBatch] Standalone drill gathering failed:", err);
  }

  // --- Rabbit Hole(s) of the Week (cycle-level) ---
  try {
    const existingHoles = await db.select({ id: rabbitHoles.id }).from(rabbitHoles).where(eq(rabbitHoles.digestId, weeklyCycleId));
    const remaining = RABBIT_HOLE_WEEKLY_TARGET - existingHoles.length;
    if (remaining > 0) {
      const activeNames = enabledInterests.map((i) => i.name);
      const recentTopicRows = await db
        .select({ topicArea: rabbitHoles.topicArea })
        .from(rabbitHoles)
        .orderBy(desc(rabbitHoles.createdAt))
        .limit(RABBIT_HOLE_AVOID_LOOKBACK);
      const localAvoid = recentTopicRows.map((r) => r.topicArea);
      for (let i = 0; i < remaining; i++) {
        const gathered = await gatherRabbitHoleMaterial(activeNames, localAvoid);
        if (!gathered) break;
        requests.push({
          contentType: "rabbit_hole_write",
          payload: { cycleId: weeklyCycleId, title: gathered.title, topicArea: gathered.topicArea, sourceName: gathered.sourceName, url: gathered.url },
          params: buildRabbitHoleWriteParams(gathered),
        });
        localAvoid.push(gathered.topicArea);
      }
    }
  } catch (err) {
    console.error("[submitBatch] Rabbit Hole gathering failed:", err);
  }

  if (requests.length === 0) {
    console.log("[submitBatch] Nothing batch-eligible to submit this round (everything pruned, quota-full, or gathering failed).");
    return;
  }

  const jobId = await submitBatch({ purpose: "round-a", dailyCycleId, weeklyCycleId, requests });
  if (jobId) {
    console.log(`[submitBatch] Submitted round-a batch job #${jobId} with ${requests.length} request(s).`);
  } else {
    console.error("[submitBatch] Batch submission failed — see errors above.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("submitBatch failed:", err);
    process.exit(1);
  });

// Phase 14 (Cost Optimization) — polls outstanding Message Batches, writes
// their results back into the normal content tables, and — for a round-a
// job that just finished — assembles and submits round-b (derived
// generation that needed round-a's News/Deep Dive output: Applied
// Insights, grounded Drills, follow-ups/self-check/essay-prompt, Mental
// Model lens, Steelman). Cheap and safe to run often (every 15-30 minutes
// is reasonable); a run with nothing outstanding does almost no work.
//
// Runs standalone (cron/Task Scheduler), same as scripts/fetch.ts and
// scripts/submitBatch.ts — NOT as a serverless function route, since
// Steelman's gather step here makes its own synchronous web-search calls
// and shouldn't be fighting a request time limit.
//
// Usage: npm run process-batches
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { ensureDb } from "../src/db/bootstrap";
import { db } from "../src/db";
import { deepDives, drills, items, modelUsage, mentalModels, interests } from "../src/db/schema";
import { eq, and, desc, isNull, isNotNull, inArray, notInArray } from "drizzle-orm";
import {
  getDailyDigestIdsForCurrentWeek,
  getOrCreateWeeklyCycleId,
  GROUNDED_DRILL_TARGET,
  ESSAY_PROMPT_CHANCE,
  ESSAY_PROMPT_LEVELS,
  MODEL_USAGE_LOOKBACK,
  MENTAL_MODEL_ITEM_CANDIDATES,
  MENTAL_MODEL_WEEKLY_TARGET,
  STEELMAN_ELIGIBLE_SLUGS,
  STEELMAN_TARGET_PER_INTEREST,
  STEELMAN_CANDIDATE_POOL,
} from "../src/lib/pipeline";
import { getInterestById, getCoveredTopics, getEnabledInterests } from "../src/lib/interests";
import { isAutoGenerationEnabled } from "../src/lib/engagement";
import { pollAndProcessBatches, submitBatch, type QueuedBatchRequest } from "../src/lib/batch";
import { applyRoundAResult, applyRoundBResult, type WrittenDeepDive } from "../src/lib/batchWriters";
import { buildFollowUpTopicsParams, buildSelfCheckParams, buildAppliedInsightParams } from "../src/lib/deepDive";
import { buildEssayPromptParams } from "../src/lib/explainBack";
import { buildGroundedDrillParams } from "../src/lib/drills";
import { buildMentalModelLensParams, type LensCandidateItem } from "../src/lib/mentalModelLens";
import { gatherSteelmanMaterial, buildSteelmanWriteParams } from "../src/lib/steelman";

async function assembleRoundB(writtenDeepDives: WrittenDeepDive[]): Promise<QueuedBatchRequest[]> {
  const requests: QueuedBatchRequest[] = [];
  const weeklyCycleId = await getOrCreateWeeklyCycleId();

  // --- Follow-ups / self-check / essay-prompt / Applied Insight, per
  // newly-written Deep Dive. ---
  for (const dive of writtenDeepDives) {
    requests.push({
      contentType: "follow_up_topics",
      payload: { deepDiveId: dive.deepDiveId, kind: "follow_up_topics" },
      params: buildFollowUpTopicsParams(dive.interestName, dive.topic, dive.content),
    });
    requests.push({
      contentType: "self_check",
      payload: { deepDiveId: dive.deepDiveId, kind: "self_check" },
      params: buildSelfCheckParams(dive.interestName, dive.topic, dive.content),
    });

    if (ESSAY_PROMPT_LEVELS.includes(dive.level) && Math.random() < ESSAY_PROMPT_CHANCE) {
      const covered = await getCoveredTopics(dive.interestId);
      requests.push({
        contentType: "essay_prompt",
        payload: { deepDiveId: dive.deepDiveId, kind: "essay_prompt" },
        params: buildEssayPromptParams(dive.interestName, covered.recent),
      });
    }

    const interest = await getInterestById(dive.interestId);
    if (interest?.generatesAppliedInsights) {
      requests.push({
        contentType: "applied_insight",
        payload: { interestId: dive.interestId, interestName: dive.interestName, deepDiveId: dive.deepDiveId },
        params: buildAppliedInsightParams(dive.interestName, dive.topic, dive.content),
      });
    }
  }

  // --- Grounded Drills, capped per cycle across ALL interests (mirrors
  // pipeline.ts's addGroundedDrills), skipping any interest currently
  // pruned for "drill". ---
  const existingGrounded = await db
    .select({ id: drills.id })
    .from(drills)
    .where(and(eq(drills.digestId, weeklyCycleId), isNotNull(drills.sourceDeepDiveId)));
  let drillSlotsLeft = GROUNDED_DRILL_TARGET - existingGrounded.length;
  for (const dive of writtenDeepDives) {
    if (drillSlotsLeft <= 0) break;
    if (!(await isAutoGenerationEnabled(dive.interestId, "drill"))) continue;
    requests.push({
      contentType: "grounded_drill",
      payload: { interestId: dive.interestId, interestName: dive.interestName, cycleId: weeklyCycleId, deepDiveId: dive.deepDiveId },
      params: buildGroundedDrillParams(dive.interestName, dive.topic, dive.content),
    });
    drillSlotsLeft--;
  }

  // --- Mental Model of the Week. No web search, so no gather step — this
  // is fully batch-eligible on its own. Simplified vs. the synchronous
  // path (refreshMentalModelsForCycle): candidates are this week's News
  // items only (no Library-chapter candidates, and one candidate model per
  // remaining slot rather than trying up to 3) — Library chapters and the
  // multi-try fallback still work via the synchronous "Refresh now" path.
  const existingUsage = await db.select({ modelId: modelUsage.modelId }).from(modelUsage).where(eq(modelUsage.digestId, weeklyCycleId));
  const mentalModelSlots = MENTAL_MODEL_WEEKLY_TARGET - existingUsage.length;
  if (mentalModelSlots > 0) {
    const enabledInterests = await getEnabledInterests();
    const interestNameById = new Map(enabledInterests.map((i) => [i.id, i.name]));
    const dailyIdsThisWeek = await getDailyDigestIdsForCurrentWeek();
    const itemRows =
      dailyIdsThisWeek.length > 0
        ? await db
            .select({ id: items.id, title: items.title, summary: items.summary, interestId: items.interestId })
            .from(items)
            .where(inArray(items.digestId, dailyIdsThisWeek))
            .orderBy(desc(items.score))
            .limit(MENTAL_MODEL_ITEM_CANDIDATES)
        : [];
    const candidates: LensCandidateItem[] = itemRows
      .filter((r) => r.interestId != null && interestNameById.has(r.interestId))
      .map((r, idx) => ({ index: idx + 1, title: r.title, summary: r.summary, interestName: interestNameById.get(r.interestId!)! }));
    const candidatesWithRef = itemRows
      .filter((r) => r.interestId != null && interestNameById.has(r.interestId))
      .map((r, idx) => ({ index: idx + 1, ref: { type: "item" as const, id: r.id } }));

    if (candidates.length > 0) {
      const recentUsageRows = await db.select({ modelId: modelUsage.modelId }).from(modelUsage).orderBy(desc(modelUsage.dateUsed)).limit(MODEL_USAGE_LOOKBACK);
      const excludedIds = [...new Set([...recentUsageRows.map((r) => r.modelId), ...existingUsage.map((r) => r.modelId)])];
      const availableModels = excludedIds.length > 0 ? await db.select().from(mentalModels).where(notInArray(mentalModels.id, excludedIds)) : await db.select().from(mentalModels);
      const pool = availableModels.length > 0 ? availableModels : await db.select().from(mentalModels);
      const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, mentalModelSlots);

      for (const model of shuffled) {
        requests.push({
          contentType: "mental_model_lens",
          payload: {
            modelId: model.id,
            cycleId: weeklyCycleId,
            candidates: candidates.map((c, i) => ({ ...c, ref: candidatesWithRef[i].ref })),
          },
          params: buildMentalModelLensParams(model.name, model.description, candidates),
        });
      }
    }
  }

  // --- Steelman companion. Needs its own synchronous gather (web search)
  // right here, since the Batches API can't run tools — only the write
  // step below is queued. ---
  const dailyIdsThisWeek = await getDailyDigestIdsForCurrentWeek();
  if (dailyIdsThisWeek.length > 0) {
    const allInterests = await db.select().from(interests);
    for (const interestRow of allInterests) {
      const eligible = STEELMAN_ELIGIBLE_SLUGS.has(interestRow.slug) || interestRow.isCustom;
      if (!eligible) continue;
      if (!(await isAutoGenerationEnabled(interestRow.id, "steelman"))) continue;

      const existingCount = await db
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.interestId, interestRow.id), inArray(items.digestId, dailyIdsThisWeek), isNotNull(items.steelmanContent)));
      const needed = STEELMAN_TARGET_PER_INTEREST - existingCount.length;
      if (needed <= 0) continue;

      const candidateRows = await db
        .select({ id: items.id, title: items.title, summary: items.summary })
        .from(items)
        .where(and(eq(items.interestId, interestRow.id), inArray(items.digestId, dailyIdsThisWeek), isNull(items.steelmanContent)))
        .orderBy(desc(items.score))
        .limit(STEELMAN_CANDIDATE_POOL);
      if (candidateRows.length === 0) continue;

      try {
        const gathered = await gatherSteelmanMaterial(
          interestRow.name,
          candidateRows.map((c, idx) => ({ index: idx + 1, title: c.title, summary: c.summary })),
          needed
        );
        if (gathered.length === 0) continue;
        const itemIdByIndex: Record<number, number> = {};
        for (const g of gathered) {
          const candidate = candidateRows[g.index - 1];
          if (candidate) itemIdByIndex[g.index] = candidate.id;
        }
        requests.push({
          contentType: "steelman_write",
          payload: { itemIdByIndex },
          params: buildSteelmanWriteParams(gathered),
        });
      } catch (err) {
        console.error(`[processBatches] Steelman gathering failed for "${interestRow.name}":`, err);
      }
    }
  }

  return requests;
}

async function main() {
  await ensureDb();

  const completedJobs = await pollAndProcessBatches();
  if (completedJobs.length === 0) {
    console.log("[processBatches] Nothing to process this run.");
    return;
  }

  const writtenDeepDives: WrittenDeepDive[] = [];
  let sawRoundA = false;
  let roundBCycleIds: { dailyCycleId: number | null; weeklyCycleId: number | null } | null = null;

  for (const job of completedJobs) {
    console.log(`[processBatches] Job #${job.id} (${job.purpose}) ended with ${job.results.length} result(s).`);
    if (job.purpose === "round-a") {
      sawRoundA = true;
      roundBCycleIds = { dailyCycleId: job.dailyCycleId, weeklyCycleId: job.weeklyCycleId };
      for (const result of job.results) {
        if (!result.ok) {
          console.error(`[processBatches] Round-a request #${result.requestId} (${result.contentType}) failed: this piece of content simply won't appear this cycle.`);
          continue;
        }
        const outcome = await applyRoundAResult(result);
        if (outcome.deepDive) writtenDeepDives.push(outcome.deepDive);
      }
    } else {
      for (const result of job.results) {
        if (!result.ok) {
          console.error(`[processBatches] Round-b request #${result.requestId} (${result.contentType}) failed: this piece of content simply won't appear this cycle.`);
          continue;
        }
        await applyRoundBResult(result);
      }
    }
  }

  if (sawRoundA) {
    const roundBRequests = await assembleRoundB(writtenDeepDives).catch((err) => {
      console.error("[processBatches] Round-b assembly failed:", err);
      return [] as QueuedBatchRequest[];
    });
    if (roundBRequests.length > 0) {
      const jobId = await submitBatch({
        purpose: "round-b",
        dailyCycleId: roundBCycleIds?.dailyCycleId ?? null,
        weeklyCycleId: roundBCycleIds?.weeklyCycleId ?? null,
        requests: roundBRequests,
      });
      console.log(jobId ? `[processBatches] Submitted round-b batch job #${jobId} with ${roundBRequests.length} request(s).` : "[processBatches] Round-b submission failed.");
    } else {
      console.log("[processBatches] Nothing to submit for round-b this run.");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("processBatches failed:", err);
    process.exit(1);
  });

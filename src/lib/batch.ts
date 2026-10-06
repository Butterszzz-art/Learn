// Phase 14 (Cost Optimization) — a small queue sitting in front of
// Anthropic's Message Batches API. Batches can take up to 24 hours to
// complete, so this is deliberately split into two independent operations:
// submitBatch() (called by scripts/submitBatch.ts, on a schedule with
// enough lead time before the content is meant to be ready) and
// pollAndProcessBatches() (called by scripts/processBatches.ts, run
// frequently — it's cheap and a no-op when nothing's outstanding). Neither
// blocks waiting for the other; content simply appears in the feed once its
// batch ends and its writer runs, the same as if it had been generated
// synchronously.
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { batchJobs, batchRequests } from "@/db/schema";
import type { BatchJobPurpose } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getAnthropicClient } from "./claude";

export interface QueuedBatchRequest {
  contentType: string;
  // Whatever the writer for this contentType needs to know that isn't in
  // the model's own response — e.g. interestId, sourceDeepDiveId, gathered
  // sources from the synchronous gather step. Must be JSON-serializable.
  payload: unknown;
  params: Anthropic.MessageCreateParamsNonStreaming;
}

/**
 * Submits one round of batch-eligible requests as a single Anthropic
 * Message Batch, recording a batchJobs row (+ one batchRequests row per
 * request) so pollAndProcessBatches can find its way back to them later.
 * Returns the new batchJobs row id, or null if there's nothing to submit
 * (empty requests, or no API key configured).
 */
export async function submitBatch(opts: {
  purpose: BatchJobPurpose;
  dailyCycleId?: number | null;
  weeklyCycleId?: number | null;
  requests: QueuedBatchRequest[];
}): Promise<number | null> {
  const anthropic = getAnthropicClient();
  if (!anthropic || opts.requests.length === 0) return null;

  // Insert request rows first — their own ids double as a stable, unique
  // custom_id for the Anthropic batch, so results can be matched straight
  // back to the row that produced them without a separate id scheme.
  const rowIds: number[] = [];
  for (const r of opts.requests) {
    const inserted = await db
      .insert(batchRequests)
      .values({ contentType: r.contentType, payload: JSON.stringify(r.payload ?? {}), status: "pending" })
      .returning({ id: batchRequests.id });
    rowIds.push(inserted[0].id);
  }

  const anthropicRequests = opts.requests.map((r, i) => ({ custom_id: `req-${rowIds[i]}`, params: r.params }));

  let created: Anthropic.Messages.MessageBatch;
  try {
    created = await anthropic.messages.batches.create({ requests: anthropicRequests });
  } catch (err) {
    console.error("[batch] submission failed:", err);
    await db
      .update(batchRequests)
      .set({ status: "failed", errorMessage: "batch submission failed" })
      .where(inArray(batchRequests.id, rowIds));
    return null;
  }

  const jobRows = await db
    .insert(batchJobs)
    .values({
      anthropicBatchId: created.id,
      purpose: opts.purpose,
      dailyCycleId: opts.dailyCycleId ?? null,
      weeklyCycleId: opts.weeklyCycleId ?? null,
      status: "submitted",
      requestCount: rowIds.length,
    })
    .returning({ id: batchJobs.id });
  const jobId = jobRows[0].id;

  for (let i = 0; i < rowIds.length; i++) {
    await db
      .update(batchRequests)
      .set({ batchJobId: jobId, customId: `req-${rowIds[i]}`, status: "submitted" })
      .where(eq(batchRequests.id, rowIds[i]));
  }

  return jobId;
}

export interface CompletedBatchRequest {
  requestId: number;
  contentType: string;
  payload: unknown;
  ok: boolean;
  text: string | null;
}

export interface CompletedBatchJob {
  id: number;
  purpose: BatchJobPurpose;
  dailyCycleId: number | null;
  weeklyCycleId: number | null;
  results: CompletedBatchRequest[];
}

/**
 * Polls every not-yet-ended batchJobs row. For any that have finished on
 * Anthropic's side, fetches the results, writes each request's outcome back
 * into its batchRequests row, marks the job "ended", and returns it (with
 * its parsed results) so the caller can dispatch each result to the right
 * content writer and, for a round-a job, submit round-b. Jobs still
 * in_progress are left alone — this is safe (and cheap) to call as often as
 * you like; a run with nothing outstanding is a fast no-op.
 */
export async function pollAndProcessBatches(): Promise<CompletedBatchJob[]> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return [];

  const openJobs = await db
    .select()
    .from(batchJobs)
    .where(inArray(batchJobs.status, ["submitted", "in_progress"]));
  const completed: CompletedBatchJob[] = [];

  for (const job of openJobs) {
    let remote: Anthropic.Messages.MessageBatch;
    try {
      remote = await anthropic.messages.batches.retrieve(job.anthropicBatchId);
    } catch (err) {
      console.error(`[batch] retrieve failed for job #${job.id}:`, err);
      continue;
    }

    if (remote.processing_status !== "ended") {
      if (job.status !== "in_progress") {
        await db.update(batchJobs).set({ status: "in_progress" }).where(eq(batchJobs.id, job.id));
      }
      continue;
    }

    const rows = await db.select().from(batchRequests).where(eq(batchRequests.batchJobId, job.id));
    const rowByCustomId = new Map(rows.map((r) => [r.customId, r]));
    const jobResults: CompletedBatchRequest[] = [];

    try {
      const stream = await anthropic.messages.batches.results(job.anthropicBatchId);
      for await (const entry of stream) {
        const row = rowByCustomId.get(entry.custom_id);
        if (!row) continue;

        let ok = false;
        let text: string | null = null;
        let errorMessage: string | null = null;
        if (entry.result.type === "succeeded") {
          const textBlock = entry.result.message.content.find((b) => b.type === "text");
          text = textBlock && textBlock.type === "text" ? textBlock.text : null;
          ok = text != null;
          if (!ok) errorMessage = "empty response";
        } else if (entry.result.type === "errored") {
          errorMessage = JSON.stringify(entry.result.error);
        } else {
          errorMessage = entry.result.type; // "canceled" | "expired"
        }

        await db
          .update(batchRequests)
          .set({ status: ok ? "succeeded" : "failed", resultText: text, errorMessage, completedAt: new Date().toISOString() })
          .where(eq(batchRequests.id, row.id));

        let payload: unknown = {};
        try {
          payload = JSON.parse(row.payload);
        } catch {
          payload = {};
        }
        jobResults.push({ requestId: row.id, contentType: row.contentType, payload, ok, text });
      }
    } catch (err) {
      console.error(`[batch] fetching results failed for job #${job.id}:`, err);
      continue;
    }

    await db
      .update(batchJobs)
      .set({ status: "ended", processedAt: new Date().toISOString() })
      .where(eq(batchJobs.id, job.id));
    completed.push({
      id: job.id,
      purpose: job.purpose,
      dailyCycleId: job.dailyCycleId,
      weeklyCycleId: job.weeklyCycleId,
      results: jobResults,
    });
  }

  return completed;
}

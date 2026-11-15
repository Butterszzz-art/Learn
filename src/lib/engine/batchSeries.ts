// Half-price writing for the shared pool. When nobody is waiting on an
// entry (the scheduler is just keeping a series a few entries ahead), the
// long-form write step goes through the Message Batches API instead of a
// live call: research is gathered now, the write is submitted as a batch,
// and the finished text is published on a later tick when the batch ends.
//
// On-demand requests (someone tapped a follow-up) never take this path.
import { client } from "@/db";
import type { Level } from "@/db/schema";
import { gatherDeepDiveMaterial, buildDeepDiveWriteParams, parseDeepDiveWriteResult } from "../deepDive";
import { submitBatch, pollAndProcessBatches } from "../batch";
import { getBatchClient } from "../ai";
import { getInterestRow, getSeriesTopics } from "../interests";
import { publishDeepDive } from "./series";

export const SERIES_WRITE = "series_write";

/** Batch writing is on unless BATCH_WRITES=0, and needs an API key. */
export function batchWritesEnabled(): boolean {
  return process.env.BATCH_WRITES !== "0" && getBatchClient() !== null;
}

interface SeriesWritePayload {
  interestId: number;
  level: Level;
  topic: string;
  sources: { title: string; url: string }[];
}

/** True while a write for this (interest, level) is sitting in an unfinished batch. */
export async function hasPendingSeriesWrite(interestId: number, level: Level): Promise<boolean> {
  const res = await client.execute({
    sql: `SELECT 1 FROM batch_requests
          WHERE content_type = ? AND status IN ('pending','submitted')
            AND json_extract(payload, '$.interestId') = ? AND json_extract(payload, '$.level') = ? LIMIT 1`,
    args: [SERIES_WRITE, interestId, level],
  });
  return res.rows.length > 0;
}

/**
 * Researches the next topic in a series now and submits its write-up as a
 * batch. Returns null if research produced nothing (the job is retried).
 */
export async function submitSeriesWrite(interestId: number, level: Level): Promise<{ batched: true; topic: string } | null> {
  const interest = await getInterestRow(interestId);
  if (!interest || interest.isLibraryBook) return null;
  if (await hasPendingSeriesWrite(interestId, level)) return { batched: true, topic: "(already submitted)" };

  const covered = await getSeriesTopics(interestId, level);
  const gathered = await gatherDeepDiveMaterial(interest.name, level, covered);
  if (!gathered) return null;

  const payload: SeriesWritePayload = { interestId, level, topic: gathered.topic, sources: gathered.sources };
  const jobId = await submitBatch({
    purpose: "round-a",
    requests: [{ contentType: SERIES_WRITE, payload, params: buildDeepDiveWriteParams(interest.name, level, covered, gathered) }],
  });
  return jobId === null ? null : { batched: true, topic: gathered.topic };
}

/** Publishes every series write whose batch has finished. Returns how many were published. */
export async function collectSeriesWrites(): Promise<number> {
  if (!getBatchClient()) return 0;
  let published = 0;
  for (const job of await pollAndProcessBatches()) {
    for (const r of job.results) {
      if (r.contentType !== SERIES_WRITE || !r.ok || !r.text) continue;
      const p = r.payload as SeriesWritePayload;
      const interest = await getInterestRow(p.interestId);
      if (!interest) continue;
      // The same topic may have been written live in the meantime (an admin tick, a follow-up).
      const dup = await client.execute({
        sql: "SELECT 1 FROM deep_dives WHERE interest_id = ? AND level = ? AND lower(topic) = lower(?) LIMIT 1",
        args: [p.interestId, p.level, p.topic],
      });
      if (dup.rows.length > 0) continue;
      await publishDeepDive(interest, p.level, { topic: p.topic, content: parseDeepDiveWriteResult(r.text), sources: p.sources }, "syllabus");
      published++;
    }
  }
  return published;
}

export async function openBatchCount(): Promise<number> {
  const res = await client.execute("SELECT COUNT(*) AS n FROM batch_jobs WHERE status IN ('submitted','in_progress')");
  return Number((res.rows[0] as any)?.n ?? 0);
}

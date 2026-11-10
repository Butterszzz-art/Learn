// A small database-backed job queue (Phase 13). Content generation no
// longer happens inside a page request: work is queued here and drained by
// the scheduled /api/cron/tick endpoint, and opportunistically by
// /api/jobs/kick while someone is waiting on an on-demand request.
//
// Jobs are deduplicated by key, so asking twice for the same thing (two
// people tapping the same follow-up, two cron ticks overlapping) costs one
// generation.
import { client } from "@/db";
import type { Level } from "@/db/schema";
import { withAiContext } from "../ai";
import { generateNextInSeries, findOrGenerateTopicDive, expandExistingDeepDive, generateLogicDrill } from "./series";
import { refreshNews } from "./news";

export type JobType = "series_next" | "topic_dive" | "expand" | "news" | "logic_drill" | "book_structure" | "book_chapter";

export interface JobPayloads {
  series_next: { interestId: number; level: Level };
  topic_dive: { interestId: number; level: Level; topic: string };
  expand: { deepDiveId: number };
  news: { interestId: number };
  logic_drill: { interestId: number };
  book_structure: { bookId: number };
  book_chapter: { bookId: number };
}

const MAX_ATTEMPTS = 3;
const STALE_LOCK_MINUTES = 10;

function sqlTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export function jobKey<T extends JobType>(type: T, payload: JobPayloads[T]): string {
  const p = payload as Record<string, unknown>;
  const parts = Object.keys(p)
    .sort()
    .map((k) => String(p[k]).toLowerCase());
  return `${type}:${parts.join(":")}`;
}

/**
 * Queues a job unless an identical one is already queued or running.
 * Returns the id of the job that will do the work (new or existing).
 */
export async function enqueue<T extends JobType>(
  type: T,
  payload: JobPayloads[T],
  opts: { userId?: number | null; delaySeconds?: number } = {}
): Promise<number> {
  const key = jobKey(type, payload);
  const existing = await client.execute({
    sql: "SELECT id FROM jobs WHERE dedupe_key = ? AND status IN ('queued','running') LIMIT 1",
    args: [key],
  });
  if (existing.rows[0]) return Number((existing.rows[0] as any).id);
  const res = await client.execute({
    sql: "INSERT INTO jobs (type, payload, dedupe_key, user_id, run_after) VALUES (?, ?, ?, ?, ?) RETURNING id",
    args: [
      type,
      JSON.stringify(payload),
      key,
      opts.userId ?? null,
      opts.delaySeconds ? sqlTime(new Date(Date.now() + opts.delaySeconds * 1000)) : null,
    ],
  });
  return Number((res.rows[0] as any).id);
}

interface JobRow {
  id: number;
  type: JobType;
  payload: string;
  user_id: number | null;
  attempts: number;
}

/** Atomically claims the next runnable job, or returns null. */
async function claimNext(preferUserId?: number): Promise<JobRow | null> {
  const now = sqlTime(new Date());
  const stale = sqlTime(new Date(Date.now() - STALE_LOCK_MINUTES * 60000));
  // A job whose worker died (serverless timeout) is picked up again once its lock is stale.
  const res = await client.execute({
    sql: `UPDATE jobs SET status = 'running', locked_at = ?, attempts = attempts + 1
          WHERE id = (
            SELECT id FROM jobs
            WHERE ((status = 'queued' AND (run_after IS NULL OR run_after <= ?))
                OR (status = 'running' AND locked_at < ?))
              AND attempts < ?
            ORDER BY (user_id IS NOT NULL AND user_id = ?) DESC, (user_id IS NOT NULL) DESC, id ASC
            LIMIT 1
          )
          RETURNING id, type, payload, user_id, attempts`,
    args: [now, now, stale, MAX_ATTEMPTS, preferUserId ?? -1],
  });
  return (res.rows[0] as unknown as JobRow) ?? null;
}

async function runJob(job: JobRow): Promise<unknown> {
  const payload = JSON.parse(job.payload);
  switch (job.type) {
    case "series_next":
      return generateNextInSeries(payload.interestId, payload.level);
    case "topic_dive":
      return findOrGenerateTopicDive(payload.interestId, payload.level, payload.topic);
    case "expand":
      return expandExistingDeepDive(payload.deepDiveId);
    case "news":
      return refreshNews(payload.interestId);
    case "logic_drill":
      return generateLogicDrill(payload.interestId);
    case "book_structure": {
      const { processBookStructure } = await import("../libraryPipeline");
      return processBookStructure(payload.bookId);
    }
    case "book_chapter": {
      const { processNextChapter } = await import("../libraryPipeline");
      return processNextChapter(payload.bookId);
    }
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

/** Runs one job. Returns false if the queue had nothing runnable. */
export async function runOne(preferUserId?: number): Promise<boolean> {
  const job = await claimNext(preferUserId);
  if (!job) return false;
  try {
    const result = await withAiContext({ userId: job.user_id, purpose: job.type }, () => runJob(job));
    // A generator returning null means "couldn't produce it" — retry later.
    if (result === null) throw new Error("generation returned nothing");
    await client.execute({
      sql: "UPDATE jobs SET status = 'done', result = ?, error = NULL, finished_at = current_timestamp WHERE id = ?",
      args: [JSON.stringify(result ?? null).slice(0, 2000), job.id],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const final = job.attempts >= MAX_ATTEMPTS;
    await client.execute({
      sql: "UPDATE jobs SET status = ?, error = ?, run_after = ?, finished_at = CASE WHEN ? THEN current_timestamp ELSE NULL END WHERE id = ?",
      args: [
        final ? "failed" : "queued",
        message.slice(0, 1000),
        sqlTime(new Date(Date.now() + 60000 * job.attempts)),
        final ? 1 : 0,
        job.id,
      ],
    });
    await client
      .execute({
        sql: "INSERT INTO error_log (user_id, source, message, detail) VALUES (?, 'job', ?, ?)",
        args: [job.user_id, `${job.type} failed (attempt ${job.attempts})`, message.slice(0, 2000)],
      })
      .catch(() => {});
  }
  return true;
}

/** Runs jobs until the queue is empty or the time budget is spent. */
export async function drain(budgetMs: number, preferUserId?: number): Promise<number> {
  const deadline = Date.now() + budgetMs;
  let ran = 0;
  while (Date.now() < deadline) {
    if (!(await runOne(preferUserId))) break;
    ran++;
  }
  return ran;
}

export async function getJob(id: number) {
  const res = await client.execute({
    sql: "SELECT id, type, status, result, error, user_id FROM jobs WHERE id = ?",
    args: [id],
  });
  const r = res.rows[0] as any;
  if (!r) return null;
  return {
    id: Number(r.id),
    type: r.type as JobType,
    status: r.status as "queued" | "running" | "done" | "failed",
    result: r.result ? JSON.parse(r.result) : null,
    error: r.error as string | null,
    userId: r.user_id === null ? null : Number(r.user_id),
  };
}

export async function pendingJobCount(): Promise<number> {
  const res = await client.execute("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running')");
  return Number((res.rows[0] as any)?.n ?? 0);
}

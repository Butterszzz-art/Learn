// OpenAI-compatible provider for News summaries — an alternative to the
// Anthropic path in claude.ts, selected purely by env vars so switching
// between Groq, OpenRouter, or any other compatible host needs no code change.
//
//   SUMMARY_LLM_API_KEY    required to enable this path
//   SUMMARY_LLM_BASE_URL   default: https://api.groq.com/openai/v1
//   SUMMARY_LLM_MODEL      default: openai/gpt-oss-120b
//
// Items are sent one per request with a flat single-object schema: batched
// array schemas were unreliable on these models (duplicated indexes, array
// emitted as object), and free tiers are token-per-minute limited, so the
// calls are sequential and paced from the provider's rate-limit headers.

const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const MAX_RETRIES = 4;
const MAX_WAIT_MS = 90_000;
const LOW_TOKEN_BUDGET = 2500;

export function hasSummaryLlm(): boolean {
  return !!process.env.SUMMARY_LLM_API_KEY;
}

// "7.47s", "1m26.4s", "250ms" -> milliseconds
function parseDuration(value: string | null): number | null {
  if (!value) return null;
  const m = value.match(/^(?:(\d+)m(?!s))?(?:(\d+(?:\.\d+)?)(ms|s))?$/);
  if (!m) return null;
  const minutes = m[1] ? Number(m[1]) * 60_000 : 0;
  const rest = m[2] ? (m[3] === "ms" ? Number(m[2]) : Number(m[2]) * 1000) : 0;
  return minutes + rest;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Thrown instead of waiting when a rate-limit pause would outlast the caller's time budget. */
export class BudgetExhausted extends Error {
  constructor() {
    super("summary time budget exhausted");
  }
}

/**
 * Wall-clock deadline for one serverless request's summarization work, so a
 * rate-limited provider can't push the route past its function time limit
 * (which returns a 504 and saves nothing). Unset locally / in scripts, where
 * waiting out the rate limit is fine. SUMMARY_TIME_BUDGET_MS overrides.
 */
export function summaryDeadline(): number | undefined {
  const ms = Number(process.env.SUMMARY_TIME_BUDGET_MS) || (process.env.VERCEL ? 30_000 : 0);
  return ms ? Date.now() + ms : undefined;
}

/**
 * One schema-constrained completion. Returns the parsed JSON object, or throws
 * on a non-retryable failure. Retries 429s after the provider's own wait hint,
 * and proactively waits out a nearly-empty token budget before the next call —
 * unless that wait would pass `deadline`, in which case it gives up early
 * (BudgetExhausted) so the caller can fall back and the work can resume later.
 */
export async function completeJson<T>(
  system: string,
  user: string,
  schema: Record<string, unknown>,
  deadline?: number
): Promise<T> {
  const baseUrl = (process.env.SUMMARY_LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = process.env.SUMMARY_LLM_MODEL || DEFAULT_MODEL;

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SUMMARY_LLM_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 3000,
          ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
          response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema } },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
    } catch (err) {
      // Transient network failure (e.g. ECONNRESET) — retry rather than drop to the fallback.
      if (attempt < MAX_RETRIES) {
        const backoff = 2000 * (attempt + 1);
        if (deadline && Date.now() + backoff > deadline) throw new BudgetExhausted();
        await sleep(backoff);
        continue;
      }
      throw err;
    }

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const waitMs = Math.min(
        ((Number(res.headers.get("retry-after")) || 0) * 1000 ||
          parseDuration(res.headers.get("x-ratelimit-reset-tokens")) ||
          15_000) + 500,
        MAX_WAIT_MS
      );
      if (deadline && Date.now() + waitMs > deadline) throw new BudgetExhausted();
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) {
      throw new Error(`summary provider ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    const remaining = Number(res.headers.get("x-ratelimit-remaining-tokens"));
    const resetMs = parseDuration(res.headers.get("x-ratelimit-reset-tokens"));
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("summary provider returned no content");
    const parsed = JSON.parse(content) as T;

    if (Number.isFinite(remaining) && remaining < LOW_TOKEN_BUDGET && resetMs) {
      const pause = Math.min(resetMs + 250, MAX_WAIT_MS);
      // Under a deadline, skip the courtesy pause: the next call will either
      // succeed or hit BudgetExhausted, and the caller handles both.
      if (!deadline) await sleep(pause);
    }
    return parsed;
  }
}

const numberTokens = (text: string): Set<string> =>
  new Set((text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, "")));

/** Numbers that appear in a summary but nowhere in the text it was written from. */
export function inventedNumbers(summary: string, source: string): string[] {
  const known = numberTokens(source);
  return [...numberTokens(summary)].filter((n) => !known.has(n));
}

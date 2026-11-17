// The one place every Claude request goes through (Phase 13).
//
//  - Model routing: three tiers. "fast" for classification, summaries, bite
//    splitting, quiz writing and feedback; "main" for deep dives and
//    web-searched roundups; "deep" for research-level deep dives.
//  - Cost tracking: every call's token usage and estimated dollar cost is
//    written to ai_usage, attributed to a user (on-demand work) or to the
//    shared pool (userId null).
//  - Refusal fallback: on models that support it, a policy decline is
//    retried server-side on a fallback model instead of failing the job.
import Anthropic from "@anthropic-ai/sdk";
import { AsyncLocalStorage } from "node:async_hooks";
import { client as dbClient } from "@/db";
import type { Plan } from "@/db/schema";
import { PLAN_LIMITS } from "./plan";

export type ModelTier = "fast" | "main" | "deep";

// Two providers, chosen per call (see routeForCurrentCall):
//  - "anthropic": paid Claude models with server-side web search and the
//    Batch API. Used for everything in the shared content pool and for
//    Pro (and admin) accounts' personal requests.
//  - "openrouter": OpenRouter's Anthropic-compatible endpoint, by default on
//    free models with no web search and no batching. Used for free-plan
//    accounts' personal requests, and for everything when there is no
//    ANTHROPIC_API_KEY.
export type AiProvider = "anthropic" | "openrouter";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api";

const hasAnthropicKey = () => !!process.env.ANTHROPIC_API_KEY;
const hasOpenRouterKey = () => !!process.env.OPENROUTER_API_KEY;

/** The default provider: paid Claude when its key is set, else OpenRouter. */
export function aiProvider(): AiProvider | null {
  if (hasAnthropicKey()) return "anthropic";
  if (hasOpenRouterKey()) return "openrouter";
  return null;
}

const ANTHROPIC_TIER_MODELS: Record<ModelTier, string> = {
  fast: process.env.ANTHROPIC_MODEL_FAST || process.env.ANTHROPIC_MODEL_HAIKU || "claude-haiku-5-5",
  main: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
  deep: process.env.ANTHROPIC_MODEL_DEEP || "claude-opus-5-5",
};

const OPENROUTER_TIER_MODELS: Record<ModelTier, string> = {
  fast: process.env.OPENROUTER_MODEL_FAST || "nvidia/nemotron-3.5-super-vl:free",
  main: process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-ultra-550b-a55b:free",
  deep: process.env.OPENROUTER_MODEL_DEEP || process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-ultra-550b-a55b:free",
};

const TIER_MODELS: Record<ModelTier, string> =
  aiProvider() === "openrouter" ? OPENROUTER_TIER_MODELS : ANTHROPIC_TIER_MODELS;

export function modelFor(tier: ModelTier): string {
  return TIER_MODELS[tier];
}

// USD per million tokens: [input, output, cache read].
const PRICES: Record<string, [number, number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5, 0.01],
  "claude-haiku-4-5": [1, 5, 0.1],
  "claude-sonnet-5-5": [2, 10, 0.1],
  "claude-sonnet-5": [2, 10, 0.2],
  "claude-sonnet-4-6": [3, 15, 0.3],
  "claude-opus-5-5": [4, 20, 0.2],
  "claude-opus-5": [5, 25, 0.5],
  "claude-opus-4-8": [5, 25, 0.5],
  "claude-fable-5-2": [8, 40, 0.2],
};
const WEB_SEARCH_USD = 0.01; // per search request

export interface UsageNumbers {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
}

/** Estimated dollar cost of one call. Unknown models are priced like the main tier. */
export function estimateCostUsd(model: string, u: UsageNumbers): number {
  if (model.endsWith(":free")) return 0;
  const [inP, outP, cacheP] = PRICES[model] ?? PRICES["claude-sonnet-5-5"];
  return (
    (u.inputTokens * inP + u.cacheWriteTokens * inP * 1.25 + u.outputTokens * outP + u.cacheReadTokens * cacheP) / 1e6 +
    u.webSearches * WEB_SEARCH_USD
  );
}

interface AiContext {
  userId: number | null;
  purpose: string;
}
const aiContext = new AsyncLocalStorage<AiContext>();

/** Tags every Claude call made inside `fn` with who it is for and why. */
export function withAiContext<T>(ctx: AiContext, fn: () => Promise<T>): Promise<T> {
  return aiContext.run(ctx, fn);
}

const clients: Partial<Record<AiProvider, Anthropic>> = {};
function clientFor(provider: AiProvider): Anthropic {
  if (!clients[provider]) {
    clients[provider] =
      provider === "anthropic"
        ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
        : // Free models are rate limited per minute; retry 429s a few more times.
          new Anthropic({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: OPENROUTER_BASE_URL, maxRetries: 5 });
  }
  return clients[provider]!;
}

// Job types whose output lands in the shared content pool. These always run
// on the paid model when there is one, whoever triggered them, because every
// reader (Pro included) sees the result.
const SHARED_POOL_PURPOSES = new Set([
  "series_next",
  "topic_dive",
  "expand",
  "news",
  "logic_drill",
  "batch_collect",
  "upgrade_summaries",
]);

const PAID_CACHE_MS = 60_000;
const paidCache = new Map<number, { paid: boolean; at: number }>();

async function userIsPaid(userId: number): Promise<boolean> {
  const hit = paidCache.get(userId);
  if (hit && Date.now() - hit.at < PAID_CACHE_MS) return hit.paid;
  let paid = false;
  try {
    const res = await dbClient.execute({ sql: "SELECT plan, role FROM users WHERE id = ?", args: [userId] });
    const row = res.rows[0] as any;
    paid = row?.role === "admin" || !!PLAN_LIMITS[row?.plan as Plan]?.paidModels;
  } catch (err) {
    console.error("[ai] plan lookup failed; using the free route:", err);
  }
  paidCache.set(userId, { paid, at: Date.now() });
  return paid;
}

/**
 * Which provider the current call goes to. Shared-pool work and anything
 * without a user goes to the paid model; a person's own requests go to the
 * paid model on Pro and to free models on the free plan.
 */
export async function routeForCurrentCall(): Promise<AiProvider | null> {
  if (!hasAnthropicKey()) return hasOpenRouterKey() ? "openrouter" : null;
  if (!hasOpenRouterKey()) return "anthropic";
  const ctx = aiContext.getStore();
  if (!ctx || ctx.userId == null || SHARED_POOL_PURPOSES.has(ctx.purpose)) return "anthropic";
  return (await userIsPaid(ctx.userId)) ? "anthropic" : "openrouter";
}

const TIER_BY_ANTHROPIC_MODEL = new Map<string, ModelTier>(
  (Object.entries(ANTHROPIC_TIER_MODELS) as [ModelTier, string][]).map(([tier, model]) => [model, tier])
);

/** The free-route model standing in for a Claude model chosen by tier. */
export function openRouterModelFor(model: string): string {
  if (model.includes("/")) return model; // already an OpenRouter slug
  return OPENROUTER_TIER_MODELS[TIER_BY_ANTHROPIC_MODEL.get(model) ?? "fast"];
}

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const SUPPORTS_FALLBACK = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-2", "claude-fable-5-1"]);
let fallbackDisabled = false; // flipped if the API rejects the parameter for this account

async function recordUsage(model: string, usage: any, opts: { purpose?: string; costMultiplier?: number } = {}): Promise<void> {
  const ctx = aiContext.getStore();
  const u: UsageNumbers = {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
    webSearches: usage?.server_tool_use?.web_search_requests ?? 0,
  };
  try {
    await dbClient.execute({
      sql: `INSERT INTO ai_usage (user_id, purpose, model, input_tokens, output_tokens, cache_read_tokens, cost_usd)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        ctx?.userId ?? null,
        opts.purpose ?? ctx?.purpose ?? "unlabeled",
        model,
        u.inputTokens + u.cacheWriteTokens,
        u.outputTokens,
        u.cacheReadTokens,
        estimateCostUsd(model, u) * (opts.costMultiplier ?? 1),
      ],
    });
  } catch (err) {
    console.error("[ai] failed to record usage:", err);
  }
}

/**
 * The unwrapped SDK client, for the Message Batches API only. Batch results
 * arrive later and out of band, so their usage is recorded with
 * recordBatchUsage rather than by the metered facade below.
 */
export function getBatchClient(): Anthropic | null {
  // OpenRouter has no Message Batches API; callers fall back to sync calls.
  return hasAnthropicKey() ? clientFor("anthropic") : null;
}

/** Batch requests are billed at half price. */
export const BATCH_COST_MULTIPLIER = 0.5;

export function recordBatchUsage(model: string, usage: unknown, purpose: string): Promise<void> {
  return recordUsage(model, usage, { purpose, costMultiplier: BATCH_COST_MULTIPLIER });
}

type CreateParams = Anthropic.MessageCreateParamsNonStreaming;

const OPENROUTER_THINKING_HEADROOM = 6000;

const NO_SEARCH_NOTE =
  "Note: web search is unavailable in this run. Work from your own knowledge only. Do not cite " +
  "sources, list URLs, or include a Sources section, and never invent links or references.";

/**
 * OpenRouter (free models): drop Anthropic's server-side web search tool and
 * effort setting, and tell the model it has no search so it doesn't invent
 * citations. Structured output (output_config.format) is passed through.
 */
export function adaptForOpenRouter(params: CreateParams): CreateParams {
  // Free models here are mostly reasoning models whose hidden thinking
  // counts against max_tokens; without headroom they can spend the whole
  // budget thinking and return no text.
  const out: any = { ...params, max_tokens: params.max_tokens + OPENROUTER_THINKING_HEADROOM };
  const tools = (params.tools ?? []) as Array<{ type?: string }>;
  const kept = tools.filter((t) => !String(t.type ?? "").startsWith("web_search"));
  const strippedSearch = kept.length < tools.length;
  if (kept.length) out.tools = kept;
  else delete out.tools;
  const oc = (params as any).output_config;
  if (oc) {
    const { effort: _effort, ...rest } = oc;
    if (Object.keys(rest).length) out.output_config = rest;
    else delete out.output_config;
  }
  if (strippedSearch) {
    if (typeof params.system === "string") out.system = `${params.system}

${NO_SEARCH_NOTE}`;
    else if (Array.isArray(params.system)) out.system = [...params.system, { type: "text", text: NO_SEARCH_NOTE }];
    else out.system = NO_SEARCH_NOTE;
  }
  return out as CreateParams;
}

/**
 * Structured outputs on the Anthropic API accept only minItems 0 or 1 and no
 * maxItems on arrays. The app's schemas state exact counts (e.g. 4 quiz
 * options, 2-4 bites), so those bounds are moved into the field's
 * description, where the model still follows them, and removed from the
 * schema itself. Callers already check counts on what comes back.
 */
export function relaxSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(relaxSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    out[k] = k === "properties" || k === "items" || k === "anyOf" || k === "oneOf" || k === "allOf" || k === "$defs" || k === "definitions"
      ? (k === "properties" || k === "$defs" || k === "definitions"
          ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, relaxSchema(pv)]))
          : relaxSchema(v))
      : v;
  }
  if (out.type === "array") {
    const min = typeof out.minItems === "number" ? out.minItems : undefined;
    const max = typeof out.maxItems === "number" ? out.maxItems : undefined;
    if ((min !== undefined && min > 1) || max !== undefined) {
      const bound =
        min !== undefined && max !== undefined
          ? min === max ? `exactly ${min}` : `${min} to ${max}`
          : min !== undefined ? `at least ${min}` : `at most ${max}`;
      const note = `Must contain ${bound} items.`;
      out.description = typeof out.description === "string" && out.description ? `${out.description} ${note}` : note;
      if (min !== undefined && min > 1) out.minItems = 1;
      delete out.maxItems;
    }
  }
  return out;
}

export function withRelaxedSchema(params: CreateParams): CreateParams {
  const format = (params as any).output_config?.format;
  if (!format?.schema) return params;
  return {
    ...(params as any),
    output_config: { ...(params as any).output_config, format: { ...format, schema: relaxSchema(format.schema) } },
  } as CreateParams;
}

async function create(rawParams: CreateParams): Promise<Anthropic.Message> {
  const params = withRelaxedSchema(rawParams);
  const route = await routeForCurrentCall();
  if (!route) throw new Error("No AI key configured (set ANTHROPIC_API_KEY or OPENROUTER_API_KEY)");
  const anthropic = clientFor(route);

  let response: Anthropic.Message;
  if (route === "openrouter") {
    response = await anthropic.messages.create(adaptForOpenRouter({ ...params, model: openRouterModelFor(params.model) }));
  } else if (SUPPORTS_FALLBACK.has(params.model) && !fallbackDisabled) {
    try {
      response = (await anthropic.beta.messages.create({
        ...(params as any),
        betas: [FALLBACK_BETA],
        fallbacks: "default",
      })) as unknown as Anthropic.Message;
    } catch (err) {
      // If this account or SDK build doesn't accept the fallback parameter,
      // run without it from here on rather than failing every generation.
      if (err instanceof Anthropic.BadRequestError && /fallback|beta/i.test(err.message)) {
        fallbackDisabled = true;
        console.warn("[ai] refusal fallback not accepted; continuing without it:", err.message);
        response = await anthropic.messages.create(params);
      } else {
        throw err;
      }
    }
  } else {
    response = await anthropic.messages.create(params);
  }
  await recordUsage(response.model || params.model, response.usage);
  return response;
}

/** What the generator modules use: the same `messages.create` shape as the SDK. */
export interface AiClient {
  messages: { create: (params: CreateParams) => Promise<Anthropic.Message> };
}

const facade: AiClient = { messages: { create } };

/** Returns the metered client, or null if no API key is configured. */
export function getAnthropicClient(): AiClient | null {
  return aiProvider() ? facade : null;
}

/** True when any AI provider is configured (paid Claude or OpenRouter). */
export function hasClaudeKey(): boolean {
  return aiProvider() !== null;
}

/** First text block of a response, or "". */
export function responseText(response: Anthropic.Message): string {
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("\n\n")
    .trim();
}

/** One structured-output call on the given tier. Returns null on refusal or bad JSON. */
export async function generateJson<T>(opts: {
  tier: ModelTier;
  schema: Record<string, unknown>;
  prompt: string;
  system?: string;
  maxTokens?: number;
}): Promise<T | null> {
  const ai = getAnthropicClient();
  if (!ai) return null;
  const response = await ai.messages.create({
    model: modelFor(opts.tier),
    max_tokens: opts.maxTokens ?? 4096,
    ...(opts.system ? { system: opts.system } : {}),
    output_config: { format: { type: "json_schema", schema: opts.schema } },
    messages: [{ role: "user", content: opts.prompt }],
  } as CreateParams);
  if (response.stop_reason === "refusal") return null;
  const text = responseText(response);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

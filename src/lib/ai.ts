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

export type ModelTier = "fast" | "main" | "deep";

const TIER_MODELS: Record<ModelTier, string> = {
  fast: process.env.ANTHROPIC_MODEL_FAST || "claude-haiku-5-5",
  main: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
  deep: process.env.ANTHROPIC_MODEL_DEEP || "claude-opus-5-5",
};

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

let rawClient: Anthropic | null | undefined;
function getRawClient(): Anthropic | null {
  if (rawClient !== undefined) return rawClient;
  rawClient = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
  return rawClient;
}

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const SUPPORTS_FALLBACK = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-2", "claude-fable-5-1"]);
let fallbackDisabled = false; // flipped if the API rejects the parameter for this account

async function recordUsage(model: string, usage: any): Promise<void> {
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
        ctx?.purpose ?? "unlabeled",
        model,
        u.inputTokens + u.cacheWriteTokens,
        u.outputTokens,
        u.cacheReadTokens,
        estimateCostUsd(model, u),
      ],
    });
  } catch (err) {
    console.error("[ai] failed to record usage:", err);
  }
}

type CreateParams = Anthropic.MessageCreateParamsNonStreaming;

async function create(params: CreateParams): Promise<Anthropic.Message> {
  const anthropic = getRawClient();
  if (!anthropic) throw new Error("ANTHROPIC_API_KEY is not configured");

  let response: Anthropic.Message;
  if (SUPPORTS_FALLBACK.has(params.model) && !fallbackDisabled) {
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
  return getRawClient() ? facade : null;
}

export function hasClaudeKey(): boolean {
  return getRawClient() !== null;
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

// Research Agent (add-on feature, powered by OpenRouter — separate from the
// Anthropic-powered pipeline everywhere else in the app). An LLM with one
// tool — search real papers via OpenAlex + Semantic Scholar — that answers a
// research question and cites what it actually found, instead of relying on
// its own training data. Independent of ANTHROPIC_API_KEY: if
// OPENROUTER_API_KEY isn't set, this feature alone is unavailable and every
// other feature in the app is unaffected.
import { fetchExternalCandidates, type CandidatePaper } from "./externalSources";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-5";
const MAX_TOOL_ROUNDS = 4;

export function hasOpenRouterKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export interface ResearchAgentResult {
  answer: string;
  papers: CandidatePaper[];
}

const SEARCH_TOOL = {
  type: "function" as const,
  function: {
    name: "search_papers",
    description:
      "Search OpenAlex and Semantic Scholar for real, published scientific papers matching a " +
      "query. Returns titles, abstracts, authors, venues, dates, DOIs, and links. These are free " +
      "public APIs with tight rate limits — call this at most 2-3 times total for the whole " +
      "question, with a small number of well-chosen, broad-ish queries rather than many narrow, " +
      "overlapping ones. Never answer from memory alone.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free-text search query, e.g. 'computational neuroscience predictive coding'.",
        },
        fromDate: {
          type: "string",
          description: "Optional ISO date (YYYY-MM-DD) — only return papers published on/after this date.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

const SYSTEM_PROMPT =
  "You are a research assistant embedded in a personal knowledge app. A user asks a question " +
  "about a scientific topic. Use the search_papers tool a small number of times (2-3 calls total " +
  "is normally enough — it hits rate-limited free public APIs) to find real, current papers before " +
  "answering — never fabricate a paper, author, finding, or statistic. Once you've called it at " +
  "least once and have enough to work with, STOP searching and write your final answer as plain " +
  "text in your reply — do not keep issuing more tool calls indefinitely. Write a clear, " +
  "substantive answer grounded in what the searches actually returned, citing papers inline by " +
  "title. If the searches turn up nothing relevant, say so plainly rather than inventing an answer.";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

async function callOpenRouter(messages: ChatMessage[], allowTools = true): Promise<any> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

  const res = await fetch(OPENROUTER_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // OpenRouter's optional attribution header — helps their leaderboard,
      // no effect on functionality if omitted.
      "X-Title": "Neuron Research Agent",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      ...(allowTools ? { tools: [SEARCH_TOOL] } : {}),
      max_tokens: 2048,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter request failed: ${res.status} ${res.statusText} ${body}`.trim());
  }

  return res.json();
}

/**
 * Runs the question through the agent's tool-calling loop and returns a
 * synthesized answer plus every paper the tool calls actually surfaced
 * (deduped), so the UI can render real, clickable sources alongside the
 * prose answer. Throws if no key is configured or the call fails — callers
 * should catch and fall back to a plain error message.
 */
/** A small delay between successive external-API calls — OpenAlex and
 * Semantic Scholar both rate-limit unauthenticated/free traffic aggressively,
 * and a tool-calling model can otherwise fire many searches in one round. */
const EXTERNAL_CALL_SPACING_MS = 600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runResearchAgent(question: string): Promise<ResearchAgentResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: question },
  ];

  const seenPapers = new Map<string, CandidatePaper>();
  // Caches search_papers results by normalized query for this run, so a
  // model that repeats/rephrases the same question doesn't double the load
  // on OpenAlex/Semantic Scholar's rate limits.
  const queryCache = new Map<string, CandidatePaper[]>();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callOpenRouter(messages);
    const choice = response.choices?.[0];
    const message = choice?.message;
    if (!message) throw new Error("OpenRouter returned no message");

    const toolCalls = message.tool_calls as ChatMessage["tool_calls"];
    if (!toolCalls || toolCalls.length === 0) {
      const answer = extractAnswerText(message);
      if (answer) return { answer, papers: [...seenPapers.values()] };
      // A reasoning-heavy model can end its turn with an empty `content` and
      // no tool calls — nudge it once instead of returning a blank answer.
      messages.push({
        role: "user",
        content:
          "Your reply had no text in it. Write your complete answer now as plain text in your reply's content — not just internal reasoning.",
      });
      continue;
    }

    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: toolCalls });

    // Run this round's tool calls one at a time, spaced out, rather than all
    // at once — the free external APIs rate-limit bursts of concurrent
    // requests, and a model can request several searches in one round.
    // Results are pushed in the original tool_calls order (some providers
    // expect that), even though they're fetched sequentially.
    const results: ChatMessage[] = [];
    for (const call of toolCalls) {
      let papers: CandidatePaper[] = [];
      let errorText: string | null = null;
      try {
        const args = JSON.parse(call.function.arguments || "{}") as {
          query?: string;
          fromDate?: string;
        };
        const query = args.query || question;
        const cacheKey = `${query.trim().toLowerCase()}|${args.fromDate ?? ""}`;
        const cached = queryCache.get(cacheKey);
        if (cached) {
          papers = cached;
        } else {
          if (queryCache.size > 0) await sleep(EXTERNAL_CALL_SPACING_MS);
          papers = await fetchExternalCandidates(query, {
            fromDate: args.fromDate,
            perSourceLimit: 8,
          });
          queryCache.set(cacheKey, papers);
        }
        for (const p of papers) seenPapers.set(p.externalId, p);
      } catch (err) {
        errorText = err instanceof Error ? err.message : "search failed";
        console.error("[researchAgent] search_papers tool call failed:", err);
      }

      results.push({
        role: "tool",
        tool_call_id: call.id,
        content: errorText
          ? JSON.stringify({ error: errorText })
          : JSON.stringify(
              papers.map((p) => ({
                title: p.title,
                authors: p.authors,
                abstract: p.abstract?.slice(0, 1500) ?? null,
                venue: p.venue,
                publishedDate: p.publishedDate,
                doi: p.doi,
                url: p.url,
                citationCount: p.citationCount,
              }))
            ),
      });
    }
    messages.push(...results);
  }

  // Ran out of rounds — ask once more without tools so the model must answer
  // from whatever it already gathered, rather than looping forever.
  messages.push({
    role: "user",
    content:
      "Stop searching now. Based on everything found so far, write your complete final answer as " +
      "plain text.",
  });
  const finalResponse = await callOpenRouter(messages, false);
  const finalMessage = finalResponse.choices?.[0]?.message;
  return {
    answer:
      (finalMessage && extractAnswerText(finalMessage)) ||
      "Ran out of search rounds before reaching a final answer.",
    papers: [...seenPapers.values()],
  };
}

/** Prefers the model's actual reply text; falls back to its reasoning trace
 * (some reasoning models put everything there and leave `content` blank) so
 * the UI never silently shows an empty answer when the model did say
 * something. */
function extractAnswerText(message: any): string {
  const content = typeof message?.content === "string" ? message.content.trim() : "";
  if (content) return content;
  const reasoning = typeof message?.reasoning === "string" ? message.reasoning.trim() : "";
  return reasoning;
}

// Phase 14 (Cost Optimization) — tiny shared helpers for prompt-caching
// breakpoints. Two things get cached across this app's generation calls:
//  1. A content type's static system-prompt/instructions text — identical on
//     every call of that type, so it's built once per module (see each
//     lib file's SYSTEM_PROMPT) and wrapped with `cachedSystem` here.
//  2. Shared context reused multiple times within one generation round —
//     chiefly a Deep Dive's full text, reused as input to its own grounded
//     Drill, Mental Model lens, and explain-back feedback — wrapped with
//     `cachedBlock` and placed first/most-stable in the message so the
//     prefix actually lines up across those calls.
import type Anthropic from "@anthropic-ai/sdk";

/** A system prompt as a single cache-eligible block. Anthropic caches on
 * exact prefix match, so every caller passing the same `text` for the same
 * content type is what makes this actually hit. */
export function cachedSystem(text: string): Anthropic.TextBlockParam[] {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

/** A reusable chunk of user-message context (e.g. a deep dive's full text)
 * as its own cache-eligible block, meant to be followed by call-specific
 * instructions in a later block so the cached prefix stays stable. */
export function cachedBlock(text: string): Anthropic.TextBlockParam {
  return { type: "text", text, cache_control: { type: "ephemeral" } };
}

/** A plain (non-cached) trailing block — the call-specific instructions that
 * come after a cachedBlock. Only exists so call sites building a `content`
 * array read consistently (cachedBlock(...), plainBlock(...)) rather than
 * mixing in raw object literals. */
export function plainBlock(text: string): Anthropic.TextBlockParam {
  return { type: "text", text };
}

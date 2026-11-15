import { NextResponse } from "next/server";
import { apiUser, fail, isResponse, readJson } from "@/lib/api";
import { getAnthropicClient, modelFor, responseText, withAiContext } from "@/lib/ai";
import { checkQuota } from "@/lib/plan";
import { client } from "@/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM =
  "You are the tutor inside a science-learning app. The reader is looking at one card and asks about it. " +
  "Answer from the provided material first; you may add well-established background knowledge, and say so " +
  "when you go beyond the material. If you are not sure, say you are not sure. Be direct and concrete: " +
  "2-6 sentences unless a longer answer is clearly needed. Plain text, no headings.";

interface Turn { role: "user" | "assistant"; content: string }

export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const body = await readJson<{ cardId?: number; deepDiveId?: number; question?: string; history?: Turn[] }>(req);
  const question = typeof body?.question === "string" ? body.question.trim().slice(0, 1000) : "";
  if (question.length < 2) return fail("Ask a question first");
  const ai = getAnthropicClient();
  if (!ai) return fail("Questions aren't configured on this server", 503);
  const quota = await checkQuota(user.id, user.plan, "ask");
  if (!quota.ok) return fail(quota.message, 402);

  let material = "";
  let deepDiveId = typeof body?.deepDiveId === "number" ? body.deepDiveId : null;
  if (typeof body?.cardId === "number") {
    const res = await client.execute({ sql: "SELECT title, body, payload, deep_dive_id FROM cards WHERE id = ? AND status = 'published'", args: [body.cardId] });
    const c = res.rows[0] as any;
    if (c) {
      material += `CARD: ${c.title}\n${c.body}\n${c.payload}\n\n`;
      deepDiveId = deepDiveId ?? (c.deep_dive_id === null ? null : Number(c.deep_dive_id));
    }
  }
  if (deepDiveId) {
    const res = await client.execute({ sql: "SELECT topic, content, sources FROM deep_dives WHERE id = ?", args: [deepDiveId] });
    const d = res.rows[0] as any;
    if (d) material += `FULL ENTRY: ${d.topic}\n${String(d.content).slice(0, 14000)}\n\nSOURCES: ${d.sources}`;
  }
  if (!material) return fail("Nothing to ask about", 404);

  const history = (Array.isArray(body?.history) ? body!.history : [])
    .filter((t) => (t?.role === "user" || t?.role === "assistant") && typeof t.content === "string")
    .slice(-6)
    .map((t) => ({ role: t.role, content: t.content.slice(0, 2000) }));

  try {
    const response = await withAiContext({ userId: user.id, purpose: "ask" }, () =>
      ai.messages.create({
        model: modelFor("fast"),
        max_tokens: 1200,
        system: SYSTEM,
        messages: [
          { role: "user", content: `Material the reader is looking at:\n\n${material}` },
          { role: "assistant", content: "Understood. What would you like to know?" },
          ...history,
          { role: "user", content: question },
        ],
      })
    );
    if (response.stop_reason === "refusal") return fail("I can't help with that question.", 422);
    return NextResponse.json({ answer: responseText(response) });
  } catch {
    return fail("Couldn't answer just now — try again", 502);
  }
}

// The public view of a card, for share links. Only published, shared-pool
// content is ever returned — nothing tied to a person.
import { client } from "@/db";

export interface PublicCard {
  id: number;
  type: string;
  title: string;
  body: string;
  takeaway: string | null;
  interestId: number | null;
  interestName: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  // Quiz and guess-the-number cards are shared as a challenge: the visitor
  // answers before seeing anything that gives the answer away.
  challenge:
    | { kind: "quiz"; options: string[]; correctIndex: number; explanation: string }
    | { kind: "estimate"; answer: number; unit: string; min: number; max: number; explanation: string }
    | null;
}

const CHALLENGE_BLURB = "Can you get this one? Answer first, then see how you did.";

export async function getPublicCard(id: number): Promise<PublicCard | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const res = await client.execute({
    sql: `SELECT c.id, c.type, c.title, c.body, c.payload, c.interest_id, i.name AS interest_name
          FROM cards c LEFT JOIN interests i ON i.id = c.interest_id
          WHERE c.id = ? AND c.status = 'published' AND c.type IN ('bite','paper','myth','fact','model','insight','debate','visual','quiz','estimate')`,
    args: [id],
  });
  const r = res.rows[0] as any;
  if (!r) return null;
  let payload: any = {};
  try {
    payload = JSON.parse(r.payload);
  } catch {}
  if (r.type === "quiz" || r.type === "estimate") {
    const challenge: PublicCard["challenge"] =
      r.type === "quiz"
        ? { kind: "quiz", options: payload.options ?? [], correctIndex: payload.correctIndex ?? 0, explanation: payload.explanation ?? "" }
        : {
            kind: "estimate",
            answer: Number(payload.answer),
            unit: payload.unit ?? "",
            min: Number(payload.min),
            max: Number(payload.max),
            explanation: payload.explanation ?? "",
          };
    return {
      id: Number(r.id),
      type: r.type,
      // A quiz card's question is its body; an estimate's is its title.
      title: r.type === "quiz" ? r.body : r.title,
      body: CHALLENGE_BLURB,
      takeaway: null,
      interestId: r.interest_id === null ? null : Number(r.interest_id),
      interestName: r.interest_name ?? null,
      sourceName: null,
      sourceUrl: null,
      challenge,
    };
  }
  return {
    id: Number(r.id),
    type: r.type,
    title: r.type === "myth" ? `Myth: ${payload.myth ?? r.title}` : r.title,
    body: r.type === "myth" ? payload.fact ?? r.body : r.body,
    takeaway: payload.takeaway ?? null,
    interestId: r.interest_id === null ? null : Number(r.interest_id),
    interestName: r.interest_name ?? null,
    sourceName: payload.sourceName ?? null,
    sourceUrl: payload.url ?? null,
    challenge: null,
  };
}

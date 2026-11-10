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
}

export async function getPublicCard(id: number): Promise<PublicCard | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const res = await client.execute({
    sql: `SELECT c.id, c.type, c.title, c.body, c.payload, c.interest_id, i.name AS interest_name
          FROM cards c LEFT JOIN interests i ON i.id = c.interest_id
          WHERE c.id = ? AND c.status = 'published' AND c.type IN ('bite','paper','myth','fact','model','insight','debate','visual')`,
    args: [id],
  });
  const r = res.rows[0] as any;
  if (!r) return null;
  let payload: any = {};
  try {
    payload = JSON.parse(r.payload);
  } catch {}
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
  };
}

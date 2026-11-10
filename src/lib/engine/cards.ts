// Writing cards and concepts into the shared pool.
import { client } from "@/db";
import type { CardType, Level } from "@/db/schema";
import { slugify } from "../interests";

export interface NewCard {
  type: CardType;
  interestId: number | null;
  level: Level | null;
  conceptId?: number | null;
  deepDiveId?: number | null;
  itemId?: number | null;
  seq?: number;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  dedupeKey: string; // makes every insert idempotent
}

/** Inserts a card unless one with the same dedupeKey exists. Returns its id. */
export async function upsertCard(card: NewCard): Promise<number> {
  await client.execute({
    sql: `INSERT OR IGNORE INTO cards (type, interest_id, level, concept_id, deep_dive_id, item_id, seq, title, body, payload, dedupe_key)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      card.type,
      card.interestId,
      card.level,
      card.conceptId ?? null,
      card.deepDiveId ?? null,
      card.itemId ?? null,
      card.seq ?? 0,
      card.title,
      card.body,
      JSON.stringify(card.payload ?? {}),
      card.dedupeKey,
    ],
  });
  const res = await client.execute({ sql: "SELECT id FROM cards WHERE dedupe_key = ?", args: [card.dedupeKey] });
  return Number((res.rows[0] as any).id);
}

export interface NewConcept {
  interestId: number;
  name: string;
  definition: string;
  difficulty: number;
  deepDiveId?: number | null;
  chapterId?: number | null;
  ownerUserId?: number | null;
}

/**
 * Finds or creates a concept by (interest, slug). An existing concept keeps
 * its original definition — the first deep dive to teach an idea owns it.
 */
export async function upsertConcept(c: NewConcept): Promise<number> {
  const slug = slugify(c.name).slice(0, 80);
  const owner = c.ownerUserId ?? null;
  const find = () =>
    client.execute({
      sql: "SELECT id FROM concepts WHERE interest_id = ? AND slug = ? AND IFNULL(owner_user_id, 0) = ?",
      args: [c.interestId, slug, owner ?? 0],
    });
  const existing = await find();
  if (existing.rows[0]) return Number((existing.rows[0] as any).id);
  try {
    await client.execute({
      sql: `INSERT INTO concepts (interest_id, slug, name, definition, difficulty, deep_dive_id, chapter_id, owner_user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        c.interestId,
        slug,
        c.name.trim().slice(0, 120),
        c.definition.trim(),
        Math.max(1, Math.min(5, Math.round(c.difficulty) || 2)),
        c.deepDiveId ?? null,
        c.chapterId ?? null,
        owner,
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/unique constraint/i.test(message)) throw err;
  }
  return Number(((await find()).rows[0] as any).id);
}

export async function addConceptEdge(fromId: number, toId: number, kind: "prereq" | "related" = "prereq") {
  if (fromId === toId) return;
  await client.execute({
    sql: "INSERT OR IGNORE INTO concept_edges (from_concept_id, to_concept_id, kind) VALUES (?, ?, ?)",
    args: [fromId, toId, kind],
  });
}

/** Level a concept's difficulty would sit at by default, for a given series level. */
export function baseDifficulty(level: Level): number {
  return { new_to_this: 1, some_background: 2, advanced: 4, research_level: 5 }[level];
}

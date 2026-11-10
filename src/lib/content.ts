// Read models for long-form content (deep dives, Library books and
// chapters, explain-it-back). Shared content is readable by anyone signed
// in; private content (books, chapters, explain-it-back entries) is always
// filtered by owner.
import { db, client } from "@/db";
import { deepDives, interests, books, bookChapters, explainBacks, appliedInsights } from "@/db/schema";
import type { Level, BookStatus, BookSourceType } from "@/db/schema";
import { eq, and, asc, desc } from "drizzle-orm";
import { generateExplainBackFeedback } from "./explainBack";
import { indexForSearch } from "./searchIndex";
import { gradeConcept, markConceptSeen } from "./learning";
import type { Grade3 } from "./learning";

export interface ExplainBackEntry {
  id: number;
  userExplanation: string;
  feedback: string;
  rating: "gaps" | "solid" | "teach" | null;
  createdAt: string;
}

export interface DeepDiveDetail {
  id: number;
  interestId: number;
  topic: string;
  content: string;
  sources: { title: string; url: string }[];
  level: Level;
  interestName: string;
  interestSlug: string;
  createdAt: string;
  status: "published" | "flagged";
  appliedInsight: string | null;
  followUpTopics: { topic: string; teaser: string }[];
  selfCheckQuestions: { question: string; options: string[]; correctIndex: number; explanation: string }[];
  essayPrompt: string | null;
  explainBacks: ExplainBackEntry[];
  concepts: { id: number; name: string; definition: string }[];
  quizCards: { cardId: number; conceptId: number | null; question: string; options: string[]; correctIndex: number; explanation: string }[];
  takeaways: string[]; // one line per bite — the "3 bullets" layer
}

export function parseJsonArray<T>(raw: string | null | undefined): T[] {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toEntry(r: typeof explainBacks.$inferSelect): ExplainBackEntry {
  return { id: r.id, userExplanation: r.userExplanation, feedback: r.feedback, rating: r.rating ?? null, createdAt: r.createdAt };
}

export async function getDeepDiveDetail(id: number, userId: number): Promise<DeepDiveDetail | null> {
  const rows = await db.select().from(deepDives).where(eq(deepDives.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  const interestRows = await db.select().from(interests).where(eq(interests.id, row.interestId)).limit(1);
  const interest = interestRows[0];

  const cardRes = await client.execute({
    sql: "SELECT id, type, concept_id, body, payload FROM cards WHERE deep_dive_id = ? AND status = 'published' ORDER BY seq",
    args: [id],
  });
  let appliedInsight: string | null = null;
  const takeaways: string[] = [];
  const quizCards: DeepDiveDetail["quizCards"] = [];
  for (const c of cardRes.rows as any[]) {
    let payload: any = {};
    try {
      payload = JSON.parse(c.payload);
    } catch {}
    if (c.type === "insight") appliedInsight = c.body;
    if (c.type === "bite" && payload.takeaway) takeaways.push(payload.takeaway);
    if (c.type === "quiz" && payload.kind === "selfcheck") {
      quizCards.push({
        cardId: Number(c.id),
        conceptId: c.concept_id === null ? null : Number(c.concept_id),
        question: c.body,
        options: payload.options ?? [],
        correctIndex: payload.correctIndex ?? 0,
        explanation: payload.explanation ?? "",
      });
    }
  }
  if (!appliedInsight) {
    const legacy = await db
      .select({ content: appliedInsights.content })
      .from(appliedInsights)
      .where(eq(appliedInsights.deepDiveId, id))
      .limit(1);
    appliedInsight = legacy[0]?.content ?? null;
  }

  const conceptRes = await client.execute({
    sql: "SELECT id, name, definition FROM concepts WHERE deep_dive_id = ? AND owner_user_id IS NULL ORDER BY id",
    args: [id],
  });
  const ebRows = await db
    .select()
    .from(explainBacks)
    .where(and(eq(explainBacks.deepDiveId, id), eq(explainBacks.userId, userId)))
    .orderBy(desc(explainBacks.createdAt));

  return {
    id: row.id,
    interestId: row.interestId,
    topic: row.topic,
    content: row.content,
    sources: parseJsonArray(row.sources),
    level: row.level,
    interestName: interest?.name ?? "Unknown",
    interestSlug: interest?.slug ?? "unknown",
    createdAt: row.createdAt,
    status: row.status,
    appliedInsight,
    followUpTopics: parseJsonArray(row.followUpTopics),
    selfCheckQuestions: parseJsonArray(row.selfCheckQuestions),
    essayPrompt: row.essayPrompt,
    explainBacks: ebRows.map(toEntry),
    concepts: (conceptRes.rows as any[]).map((c) => ({ id: Number(c.id), name: c.name, definition: c.definition })),
    quizCards,
    takeaways: takeaways.slice(0, 4),
  };
}

/** Opening a deep dive counts as meeting its concepts. */
export async function markDeepDiveOpened(deepDiveId: number, userId: number): Promise<void> {
  const res = await client.execute({
    sql: "SELECT id FROM concepts WHERE deep_dive_id = ? AND owner_user_id IS NULL",
    args: [deepDiveId],
  });
  for (const r of res.rows as any[]) await markConceptSeen(userId, Number(r.id));
}

export interface BookListEntry {
  id: number;
  title: string;
  author: string | null;
  status: BookStatus;
  errorMessage: string | null;
  totalChapters: number;
  chaptersProcessed: number;
  chaptersSurfaced: number;
  paceChaptersPerCycle: number;
  uploadDate: string;
  sourceType: BookSourceType;
}

export async function getLibraryBooks(userId: number): Promise<BookListEntry[]> {
  const res = await client.execute({
    sql: `SELECT b.id, b.title, b.author, b.status, b.error_message, b.total_chapters, b.pace_chapters_per_cycle,
                 b.upload_date, b.source_type,
                 (SELECT COUNT(*) FROM book_chapters c WHERE c.book_id = b.id AND c.summary IS NOT NULL) AS processed,
                 (SELECT COUNT(*) FROM book_chapters c WHERE c.book_id = b.id AND c.status = 'surfaced') AS surfaced
          FROM books b WHERE b.user_id = ? ORDER BY b.upload_date DESC`,
    args: [userId],
  });
  return (res.rows as any[]).map((b) => ({
    id: Number(b.id),
    title: b.title,
    author: b.author,
    status: b.status,
    errorMessage: b.error_message,
    totalChapters: Number(b.total_chapters),
    chaptersProcessed: Number(b.processed),
    chaptersSurfaced: Number(b.surfaced),
    paceChaptersPerCycle: Number(b.pace_chapters_per_cycle),
    uploadDate: b.upload_date,
    sourceType: b.source_type,
  }));
}

export interface BookChapterListEntry {
  id: number;
  chapterNumber: number;
  title: string;
  status: "pending" | "surfaced";
  hasContent: boolean;
}

export interface BookDetail {
  id: number;
  title: string;
  author: string | null;
  status: BookStatus;
  errorMessage: string | null;
  totalChapters: number;
  paceChaptersPerCycle: number;
  chapters: BookChapterListEntry[];
}

export async function getBookById(id: number, userId: number): Promise<BookDetail | null> {
  const rows = await db.select().from(books).where(and(eq(books.id, id), eq(books.userId, userId))).limit(1);
  const book = rows[0];
  if (!book) return null;
  const chapterRows = await db
    .select()
    .from(bookChapters)
    .where(eq(bookChapters.bookId, id))
    .orderBy(asc(bookChapters.chapterNumber));
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    status: book.status,
    errorMessage: book.errorMessage,
    totalChapters: book.totalChapters,
    paceChaptersPerCycle: book.paceChaptersPerCycle,
    chapters: chapterRows.map((c) => ({
      id: c.id,
      chapterNumber: c.chapterNumber,
      title: c.title,
      status: c.status,
      hasContent: c.summary != null,
    })),
  };
}

export interface ChapterDetail {
  id: number;
  bookId: number;
  bookTitle: string;
  chapterNumber: number;
  title: string;
  summary: string | null;
  keyConcepts: { term: string; definition: string }[];
  notableArguments: string[];
  quotes: string[];
  explainBacks: ExplainBackEntry[];
}

export async function getChapterById(id: number, userId: number): Promise<ChapterDetail | null> {
  const rows = await db
    .select({ chapter: bookChapters, book: books })
    .from(bookChapters)
    .innerJoin(books, eq(bookChapters.bookId, books.id))
    .where(and(eq(bookChapters.id, id), eq(books.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row || row.chapter.summary == null) return null;
  const ebRows = await db
    .select()
    .from(explainBacks)
    .where(and(eq(explainBacks.chapterId, id), eq(explainBacks.userId, userId)))
    .orderBy(desc(explainBacks.createdAt));
  return {
    id: row.chapter.id,
    bookId: row.book.id,
    bookTitle: row.book.title,
    chapterNumber: row.chapter.chapterNumber,
    title: row.chapter.title,
    summary: row.chapter.summary,
    keyConcepts: parseJsonArray(row.chapter.keyConcepts),
    notableArguments: parseJsonArray(row.chapter.notableArguments),
    quotes: parseJsonArray(row.chapter.quotes),
    explainBacks: ebRows.map(toEntry),
  };
}

/** Reading a chapter marks it surfaced and its concepts as met. */
export async function markChapterOpened(chapterId: number, userId: number): Promise<void> {
  await client.execute({
    sql: `UPDATE book_chapters SET status = 'surfaced', surfaced_at = COALESCE(surfaced_at, current_timestamp)
          WHERE id = ? AND book_id IN (SELECT id FROM books WHERE user_id = ?)`,
    args: [chapterId, userId],
  });
  const res = await client.execute({
    sql: "SELECT id FROM concepts WHERE chapter_id = ? AND owner_user_id = ?",
    args: [chapterId, userId],
  });
  for (const r of res.rows as any[]) await markConceptSeen(userId, Number(r.id));
}

export interface ExplainBackDetail {
  entry: ExplainBackEntry;
  parentTitle: string;
  parentType: "deepDive" | "chapter";
  parentId: number;
}

export async function getExplainBackById(id: number, userId: number): Promise<ExplainBackDetail | null> {
  const rows = await db.select().from(explainBacks).where(and(eq(explainBacks.id, id), eq(explainBacks.userId, userId))).limit(1);
  const row = rows[0];
  if (!row) return null;
  const entry = toEntry(row);
  if (row.deepDiveId) {
    const d = await db.select({ topic: deepDives.topic }).from(deepDives).where(eq(deepDives.id, row.deepDiveId)).limit(1);
    return { entry, parentTitle: d[0]?.topic ?? "Untitled", parentType: "deepDive", parentId: row.deepDiveId };
  }
  if (row.chapterId) {
    const c = await db.select({ title: bookChapters.title }).from(bookChapters).where(eq(bookChapters.id, row.chapterId)).limit(1);
    return { entry, parentTitle: c[0]?.title ?? "Untitled", parentType: "chapter", parentId: row.chapterId };
  }
  return null;
}

export interface ExplainBackResult {
  id: number;
  feedback: string;
  rating: "gaps" | "solid" | "teach";
}

const RATING_GRADE: Record<ExplainBackResult["rating"], Grade3> = { gaps: "again", solid: "good", teach: "easy" };

/**
 * The reader explains a deep dive back in their own words. They get
 * supportive written feedback; privately, a three-level rating (gaps /
 * solid / could teach it) updates their mastery of that entry's concepts.
 */
export async function submitExplainBack(userId: number, deepDiveId: number, text: string): Promise<ExplainBackResult | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const rows = await db.select().from(deepDives).where(eq(deepDives.id, deepDiveId)).limit(1);
  const dive = rows[0];
  if (!dive) return null;

  const prompt = dive.essayPrompt || "Explain this back in your own words.";
  const result = await generateExplainBackFeedback(dive.topic, dive.content, prompt, trimmed);
  if (!result) return null;

  const inserted = await db
    .insert(explainBacks)
    .values({ deepDiveId, userId, userExplanation: trimmed, feedback: result.feedback, rating: result.rating })
    .returning({ id: explainBacks.id });

  const conceptRes = await client.execute({
    sql: "SELECT id FROM concepts WHERE deep_dive_id = ? AND owner_user_id IS NULL",
    args: [deepDiveId],
  });
  for (const r of conceptRes.rows as any[]) await gradeConcept(userId, Number(r.id), RATING_GRADE[result.rating]);

  const interestRows = await db.select({ name: interests.name }).from(interests).where(eq(interests.id, dive.interestId)).limit(1);
  await indexForSearch({
    contentType: "explain_back",
    sourceId: inserted[0].id,
    title: `Explain it back — ${dive.topic}`,
    body: `${trimmed}\n\n${result.feedback}`,
    interestLabel: interestRows[0]?.name ?? "Unknown",
    interestId: dive.interestId,
    date: new Date().toISOString(),
    url: `/deep-dive/${deepDiveId}`,
    userId,
  });
  return { id: inserted[0].id, feedback: result.feedback, rating: result.rating };
}

export async function submitChapterExplainBack(userId: number, chapterId: number, text: string): Promise<ExplainBackResult | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const chapter = await getChapterById(chapterId, userId);
  if (!chapter || !chapter.summary) return null;

  const result = await generateExplainBackFeedback(
    chapter.title,
    chapter.summary,
    "Explain this chapter back in your own words.",
    trimmed
  );
  if (!result) return null;

  const inserted = await db
    .insert(explainBacks)
    .values({ chapterId, userId, userExplanation: trimmed, feedback: result.feedback, rating: result.rating })
    .returning({ id: explainBacks.id });

  const conceptRes = await client.execute({
    sql: "SELECT id FROM concepts WHERE chapter_id = ? AND owner_user_id = ?",
    args: [chapterId, userId],
  });
  for (const r of conceptRes.rows as any[]) await gradeConcept(userId, Number(r.id), RATING_GRADE[result.rating]);

  await indexForSearch({
    contentType: "explain_back",
    sourceId: inserted[0].id,
    title: `Explain it back — ${chapter.title}`,
    body: `${trimmed}\n\n${result.feedback}`,
    interestLabel: `Library: ${chapter.bookTitle}`,
    interestId: null,
    date: new Date().toISOString(),
    url: `/library/chapter/${chapterId}`,
    userId,
  });
  return { id: inserted[0].id, feedback: result.feedback, rating: result.rating };
}

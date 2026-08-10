import { db } from "@/db";
import { books, bookChapters } from "@/db/schema";
import type { BookStatus } from "@/db/schema";
import { eq, asc, isNull, and } from "drizzle-orm";
import { identifyBookStructure, processChapterContent } from "./library";
import { hasClaudeKey } from "./claude";

// Default when the user skips "finish in about __ weeks" at upload time.
const DEFAULT_PACE_CHAPTERS_PER_CYCLE = 1;

export interface CreateBookResult {
  id: number;
}

/**
 * Creates the books row from an already-read, base64-encoded PDF — no
 * Claude processing yet, just storage + bookkeeping. Title is a filename-
 * derived placeholder until the structure pass identifies the real one.
 */
export async function createBook(
  originalFilename: string,
  base64Pdf: string,
  paceWeeksRequested: number | null
): Promise<CreateBookResult> {
  const inserted = await db
    .insert(books)
    .values({
      title: originalFilename.replace(/\.pdf$/i, ""),
      originalFilename,
      fileBase64: base64Pdf,
      status: "processing",
      paceWeeksRequested,
      paceChaptersPerCycle: DEFAULT_PACE_CHAPTERS_PER_CYCLE,
    })
    .returning({ id: books.id });
  return { id: inserted[0].id };
}

export interface StructureStepResult {
  bookId: number;
  status: BookStatus;
  totalChapters: number;
  errorMessage: string | null;
}

/**
 * First processing pass: identifies the book's title/author/chapter
 * structure, creates placeholder book_chapters rows (title + page range,
 * no content yet), and computes paceChaptersPerCycle from the user's
 * requested weeks now that totalChapters is finally known. A PDF Claude
 * flags as unreadable (no text layer) or otherwise fails to structure sets
 * status="error" with a clear message rather than silently failing.
 * Idempotent — no-ops if chapters already exist for this book.
 */
export async function processBookStructure(bookId: number): Promise<StructureStepResult | null> {
  if (!hasClaudeKey()) return null;

  const rows = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
  const book = rows[0];
  if (!book) return null;

  const existingChapters = await db
    .select({ id: bookChapters.id })
    .from(bookChapters)
    .where(eq(bookChapters.bookId, book.id))
    .limit(1);
  if (existingChapters.length > 0 || book.status !== "processing") {
    return { bookId, status: book.status, totalChapters: book.totalChapters, errorMessage: book.errorMessage };
  }

  const structure = await identifyBookStructure(book.fileBase64);

  if (!structure) {
    const message = "Couldn't read this PDF's structure — try uploading it again, or the file may be corrupted.";
    await db.update(books).set({ status: "error", errorMessage: message }).where(eq(books.id, bookId));
    return { bookId, status: "error", totalChapters: 0, errorMessage: message };
  }
  if (!structure.readable) {
    const message =
      structure.unreadableReason ||
      "This PDF has no extractable text layer — it looks like a scanned image-only book. OCR would be needed first.";
    await db.update(books).set({ status: "error", errorMessage: message }).where(eq(books.id, bookId));
    return { bookId, status: "error", totalChapters: 0, errorMessage: message };
  }

  const totalChapters = structure.chapters.length;
  const paceChaptersPerCycle =
    book.paceWeeksRequested && book.paceWeeksRequested > 0
      ? Math.max(1, Math.ceil(totalChapters / book.paceWeeksRequested))
      : DEFAULT_PACE_CHAPTERS_PER_CYCLE;

  await db
    .update(books)
    .set({
      title: structure.title || book.title,
      author: structure.author || null,
      totalChapters,
      paceChaptersPerCycle,
    })
    .where(eq(books.id, bookId));

  for (const ch of structure.chapters) {
    await db.insert(bookChapters).values({
      bookId,
      chapterNumber: ch.number,
      title: ch.title,
      startPage: ch.startPage,
      endPage: ch.endPage,
      status: "pending",
    });
  }

  return { bookId, status: "processing", totalChapters, errorMessage: null };
}

export interface ChapterStepResult {
  bookId: number;
  done: boolean; // true once every chapter has content (books.status flips to "ready")
  chapterNumber: number | null;
  chaptersRemaining: number;
}

/**
 * Processes the next not-yet-content-generated chapter (lowest chapter
 * number with summary still null) for a book. Called repeatedly by the
 * client — same "loop a granular per-step endpoint" pattern as
 * RefreshButton.tsx's deep-dive loop — until it reports done=true, at
 * which point books.status flips to "ready". Idempotent per chapter: a
 * chapter that already has a summary is skipped, so retries never
 * duplicate work.
 */
export async function processNextChapter(bookId: number): Promise<ChapterStepResult | null> {
  if (!hasClaudeKey()) return null;

  const rows = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
  const book = rows[0];
  if (!book || book.status !== "processing") return null;

  const pending = await db
    .select()
    .from(bookChapters)
    .where(and(eq(bookChapters.bookId, bookId), isNull(bookChapters.summary)))
    .orderBy(asc(bookChapters.chapterNumber))
    .limit(1);

  const next = pending[0];
  if (!next) {
    await db.update(books).set({ status: "ready", fileBase64: "" }).where(eq(books.id, bookId));
    return { bookId, done: true, chapterNumber: null, chaptersRemaining: 0 };
  }

  try {
    const content = await processChapterContent(book.fileBase64, book.title, {
      number: next.chapterNumber,
      title: next.title,
      startPage: next.startPage ?? 1,
      endPage: next.endPage ?? next.startPage ?? 1,
    });
    if (content) {
      await db
        .update(bookChapters)
        .set({
          summary: content.summary,
          keyConcepts: JSON.stringify(content.keyConcepts),
          notableArguments: JSON.stringify(content.notableArguments),
          quotes: JSON.stringify(content.quotes),
        })
        .where(eq(bookChapters.id, next.id));
    } else {
      // Leave summary null so this chapter gets retried on the next call —
      // a single failed chapter shouldn't stall the whole book.
      console.error(`[libraryPipeline] Chapter content generation failed for book #${bookId} ch.${next.chapterNumber}`);
    }
  } catch (err) {
    console.error(`[libraryPipeline] Chapter processing threw for book #${bookId} ch.${next.chapterNumber}:`, err);
  }

  const remainingRows = await db
    .select({ id: bookChapters.id })
    .from(bookChapters)
    .where(and(eq(bookChapters.bookId, bookId), isNull(bookChapters.summary)));
  return { bookId, done: false, chapterNumber: next.chapterNumber, chaptersRemaining: remainingRows.length };
}

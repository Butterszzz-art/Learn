import { db } from "@/db";
import { books, bookChapters } from "@/db/schema";
import type { BookStatus, BookSourceType } from "@/db/schema";
import { eq, asc, isNull, and } from "drizzle-orm";
import { identifyBookStructure, processChapterContent, processChapterContentFromText } from "./library";
import { parseEpub } from "./epub";
import { fetchArticleWithTitle } from "./articleFetch";
import { hasClaudeKey } from "./claude";
import { indexForSearch } from "./searchIndex";

// Default when the user skips "finish in about __ weeks" at upload time.
const DEFAULT_PACE_CHAPTERS_PER_CYCLE = 1;

export interface CreateBookResult {
  id: number;
}

function fallbackTitle(originalFilename: string, sourceType: BookSourceType): string {
  if (sourceType === "pdf") return originalFilename.replace(/\.pdf$/i, "");
  if (sourceType === "epub") return originalFilename.replace(/\.epub$/i, "");
  return originalFilename; // url_article: caller passes a sensible placeholder (e.g. the URL itself)
}

/**
 * Creates the books row — no Claude/parsing work yet, just storage +
 * bookkeeping. `base64File` is the uploaded file's raw bytes for pdf/epub,
 * or "" for url_article (which has a URL instead — see `sourceUrl`). Title
 * is a placeholder until the structure pass identifies/extracts the real
 * one (PDF via Claude, EPUB via its own metadata, url_article via the
 * fetched page's title).
 */
export async function createBook(
  originalFilename: string,
  base64File: string,
  paceWeeksRequested: number | null,
  sourceType: BookSourceType = "pdf",
  sourceUrl: string | null = null
): Promise<CreateBookResult> {
  const inserted = await db
    .insert(books)
    .values({
      title: fallbackTitle(originalFilename, sourceType),
      originalFilename,
      fileBase64: base64File,
      sourceType,
      sourceUrl,
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

async function markBookError(bookId: number, message: string): Promise<StructureStepResult> {
  await db.update(books).set({ status: "error", errorMessage: message }).where(eq(books.id, bookId));
  return { bookId, status: "error", totalChapters: 0, errorMessage: message };
}

function computePace(totalChapters: number, paceWeeksRequested: number | null): number {
  return paceWeeksRequested && paceWeeksRequested > 0
    ? Math.max(1, Math.ceil(totalChapters / paceWeeksRequested))
    : DEFAULT_PACE_CHAPTERS_PER_CYCLE;
}

/**
 * First processing pass: identifies the book's title/author/chapter
 * structure and creates placeholder book_chapters rows, then computes
 * paceChaptersPerCycle from the user's requested weeks now that
 * totalChapters is finally known. Branches on source_type — PDF asks Claude
 * to read the document directly (Phase 7); EPUB and url_article extract
 * structure themselves (parseEpub / fetchArticleWithTitle) with no Claude
 * call needed for this step, storing each chapter's already-extracted text
 * in raw_text for the next step to process. A source that turns out
 * unreadable/unfetchable sets status="error" with a clear message rather
 * than failing silently. Idempotent — no-ops if chapters already exist.
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

  if (book.sourceType === "epub") {
    const parsed = await parseEpub(book.fileBase64);
    if (!parsed) {
      return markBookError(
        bookId,
        "Couldn't read this EPUB's structure — it may be corrupted, DRM-protected, or use an unsupported layout."
      );
    }

    const totalChapters = parsed.chapters.length;
    const paceChaptersPerCycle = computePace(totalChapters, book.paceWeeksRequested);

    await db
      .update(books)
      .set({
        title: parsed.title || book.title,
        author: parsed.author,
        totalChapters,
        paceChaptersPerCycle,
        fileBase64: "", // already extracted into each chapter's raw_text below — no longer needed
      })
      .where(eq(books.id, bookId));

    for (let i = 0; i < parsed.chapters.length; i++) {
      const ch = parsed.chapters[i];
      await db.insert(bookChapters).values({
        bookId,
        chapterNumber: i + 1,
        title: ch.title,
        rawText: ch.text,
        status: "pending",
      });
    }

    return { bookId, status: "processing", totalChapters, errorMessage: null };
  }

  if (book.sourceType === "url_article") {
    if (!book.sourceUrl) return markBookError(bookId, "No URL was provided for this article.");

    const fetched = await fetchArticleWithTitle(book.sourceUrl);
    if (!fetched) {
      return markBookError(
        bookId,
        "Couldn't fetch or read this article — the page may be behind a paywall, blocked, or unreachable."
      );
    }

    await db
      .update(books)
      .set({
        title: fetched.title,
        totalChapters: 1,
        paceChaptersPerCycle: 1, // only ever one "chapter" — the whole article
      })
      .where(eq(books.id, bookId));

    await db.insert(bookChapters).values({
      bookId,
      chapterNumber: 1,
      title: fetched.title,
      rawText: fetched.text,
      status: "pending",
    });

    return { bookId, status: "processing", totalChapters: 1, errorMessage: null };
  }

  // source_type="pdf" — Phase 7's original path, Claude reads the PDF directly.
  const structure = await identifyBookStructure(book.fileBase64);

  if (!structure) {
    return markBookError(bookId, "Couldn't read this PDF's structure — try uploading it again, or the file may be corrupted.");
  }
  if (!structure.readable) {
    return markBookError(
      bookId,
      structure.unreadableReason ||
        "This PDF has no extractable text layer — it looks like a scanned image-only book. OCR would be needed first."
    );
  }

  const totalChapters = structure.chapters.length;
  const paceChaptersPerCycle = computePace(totalChapters, book.paceWeeksRequested);

  await db
    .update(books)
    .set({ title: structure.title || book.title, author: structure.author || null, totalChapters, paceChaptersPerCycle })
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
 * which point books.status flips to "ready". Branches on source_type: PDF
 * sends the document again (Phase 7, needs page-range windowing); EPUB and
 * url_article already have the chapter's plain text in raw_text (structure
 * step above), processed via processChapterContentFromText and cleared
 * from raw_text once done — same "don't hold onto it once it's no longer
 * needed" reasoning as books.fileBase64. Idempotent per chapter: a chapter
 * that already has a summary is skipped, so retries never duplicate work.
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
    const content =
      book.sourceType === "pdf"
        ? await processChapterContent(book.fileBase64, book.title, {
            number: next.chapterNumber,
            title: next.title,
            startPage: next.startPage ?? 1,
            endPage: next.endPage ?? next.startPage ?? 1,
          })
        : await processChapterContentFromText(book.title, next.title, next.rawText ?? "");

    if (content) {
      await db
        .update(bookChapters)
        .set({
          summary: content.summary,
          keyConcepts: JSON.stringify(content.keyConcepts),
          notableArguments: JSON.stringify(content.notableArguments),
          quotes: JSON.stringify(content.quotes),
          rawText: null, // no longer needed once processed
        })
        .where(eq(bookChapters.id, next.id));
      const keyConceptsText = content.keyConcepts.map((c) => `${c.term}: ${c.definition}`).join("\n");
      indexForSearch({
        contentType: "chapter",
        sourceId: next.id,
        title: next.title,
        body: `${content.summary}\n\n${keyConceptsText}`,
        interestLabel: `Library: ${book.title}`,
        interestId: null,
        date: new Date().toISOString(),
        url: `/library/chapter/${next.id}`,
      }).catch((err) => console.error("[libraryPipeline] search-index failed for chapter:", err));
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

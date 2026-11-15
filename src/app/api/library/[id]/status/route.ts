import { NextResponse } from "next/server";
import { apiUser, fail, isResponse } from "@/lib/api";
import { getBookById } from "@/lib/content";
import { enqueue } from "@/lib/engine/jobs";

export const dynamic = "force-dynamic";

/**
 * Processing progress for one book. While it is still processing this also
 * makes sure the next step is queued (structure first, then one chapter at
 * a time), so progress never stalls waiting for someone to push it.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const bookId = Number(params.id);
  const book = await getBookById(bookId, user.id);
  if (!book) return fail("Not found", 404);
  const processed = book.chapters.filter((c) => c.hasContent).length;
  if (book.status === "processing") {
    await enqueue(book.chapters.length === 0 ? "book_structure" : "book_chapter", { bookId }, { userId: user.id });
  }
  return NextResponse.json({
    status: book.status,
    title: book.title,
    errorMessage: book.errorMessage,
    totalChapters: book.totalChapters,
    chaptersProcessed: processed,
  });
}

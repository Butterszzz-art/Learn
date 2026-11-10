import Link from "next/link";
import type { BookListEntry } from "@/lib/content";

const STATUS_LABEL: Record<BookListEntry["status"], string> = { processing: "Processing…", ready: "Ready", error: "Couldn't process" };
const SOURCE_LABEL: Record<BookListEntry["sourceType"], string> = { pdf: "PDF", epub: "EPUB", url_article: "Article" };

export function BookCard({ book }: { book: BookListEntry }) {
  const tone = book.status === "ready" ? "!border-neuron-accent3/50 !text-neuron-accent3" : book.status === "error" ? "!border-neuron-danger/50 !text-neuron-danger" : "";
  const inner = (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`pill ${tone}`}>{STATUS_LABEL[book.status]}</span>
        <span className="pill">{SOURCE_LABEL[book.sourceType]}</span>
        {book.status !== "error" && book.totalChapters > 0 && <span className="pill">{book.chaptersSurfaced}/{book.totalChapters} read</span>}
      </div>
      <p className="font-display text-lg font-bold leading-snug">{book.title}</p>
      {book.author && <p className="text-sm text-neuron-muted">{book.author}</p>}
      {book.status === "processing" && book.totalChapters > 0 && (
        <p className="mt-2 text-sm text-neuron-muted">{book.chaptersProcessed} of {book.totalChapters} chapters turned into notes so far</p>
      )}
      {book.status === "error" && book.errorMessage && <p className="mt-2 text-sm text-neuron-danger">{book.errorMessage}</p>}
    </>
  );
  // A book can be opened as soon as it has any chapters, even mid-processing.
  if (book.status === "error" || book.totalChapters === 0) return <div className="card">{inner}</div>;
  return <Link href={`/library/${book.id}`} className="card block transition hover:border-neuron-accent">{inner}</Link>;
}

import Link from "next/link";
import type { BookListEntry } from "@/lib/digest";

const STATUS_LABEL: Record<BookListEntry["status"], string> = {
  processing: "Processing…",
  ready: "Ready",
  error: "Error",
};

const SOURCE_TYPE_LABEL: Record<BookListEntry["sourceType"], string> = {
  pdf: "PDF",
  epub: "EPUB",
  url_article: "Article",
};

export function BookCard({ book }: { book: BookListEntry }) {
  const content = (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`pill ${
            book.status === "ready"
              ? "border-neuron-accent3/50 text-neuron-accent3"
              : book.status === "error"
                ? "border-red-500/50 text-red-400"
                : "text-neuron-muted"
          }`}
        >
          {STATUS_LABEL[book.status]}
        </span>
        <span className="pill">{SOURCE_TYPE_LABEL[book.sourceType]}</span>
        {book.status !== "error" && book.totalChapters > 0 && (
          <span className="pill">
            {book.chaptersSurfaced}/{book.totalChapters} chapters read
          </span>
        )}
      </div>
      <p className="font-display text-lg font-semibold leading-snug">{book.title}</p>
      {book.author && <p className="text-xs text-neuron-muted">{book.author}</p>}
      {book.status === "processing" && book.totalChapters > 0 && (
        <p className="mt-2 text-xs text-neuron-muted">
          {book.chaptersProcessed}/{book.totalChapters} chapters processed…
        </p>
      )}
      {book.status === "error" && book.errorMessage && (
        <p className="mt-2 text-xs text-red-400">{book.errorMessage}</p>
      )}
    </>
  );

  if (book.status !== "ready") {
    return <div className="card">{content}</div>;
  }
  return (
    <Link
      href={`/library/${book.id}`}
      className="card block transition hover:-translate-y-0.5 hover:border-neuron-accent3 hover:shadow-xl hover:shadow-neuron-accent3/10"
    >
      {content}
    </Link>
  );
}

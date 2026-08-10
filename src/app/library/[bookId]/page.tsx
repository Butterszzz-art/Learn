import Link from "next/link";
import { notFound } from "next/navigation";
import { getBookById } from "@/lib/digest";

export const dynamic = "force-dynamic";

export default async function BookPage({ params }: { params: { bookId: string } }) {
  const id = Number(params.bookId);
  if (!Number.isFinite(id)) notFound();

  const book = await getBookById(id);
  if (!book) notFound();

  return (
    <div>
      <Link href="/library" className="mb-4 inline-block text-xs text-neuron-muted hover:text-neuron-text">
        ← Back to Library
      </Link>

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold">{book.title}</h1>
        {book.author && <p className="text-sm text-neuron-muted">{book.author}</p>}
        <p className="mt-1 text-xs text-neuron-muted">
          {book.totalChapters} chapters · {book.paceChaptersPerCycle}/cycle pace
        </p>
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neuron-muted">
        Table of contents
      </h2>
      <ul className="space-y-2">
        {book.chapters.map((chapter) => {
          const readable = chapter.hasContent;
          return (
            <li key={chapter.id}>
              {readable ? (
                <Link
                  href={`/library/chapter/${chapter.id}`}
                  className="card flex items-center justify-between transition hover:border-neuron-accent3"
                >
                  <span>
                    <span className="text-neuron-muted">Ch. {chapter.chapterNumber}</span> · {chapter.title}
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    {chapter.status === "pending" && <span className="pill">not yet in your feed</span>}
                    <span className="text-neuron-accent3">Read →</span>
                  </span>
                </Link>
              ) : (
                <div className="card flex items-center justify-between opacity-60">
                  <span>
                    <span className="text-neuron-muted">Ch. {chapter.chapterNumber}</span> · {chapter.title}
                  </span>
                  <span className="pill">processing…</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBookById } from "@/lib/content";

export const dynamic = "force-dynamic";

export default async function BookPage({ params }: { params: { bookId: string } }) {
  const user = await requireUser();
  const book = await getBookById(Number(params.bookId), user.id);
  if (!book) notFound();
  const ready = book.chapters.filter((c) => c.hasContent).length;
  return (
    <div>
      <Link href="/library" className="text-sm font-bold text-neuron-accent">← Library</Link>
      <h1 className="page-title mt-4">{book.title}</h1>
      {book.author && <p className="text-neuron-muted">{book.author}</p>}
      <p className="mt-2 text-sm text-neuron-muted">
        {ready} of {book.totalChapters} chapters have notes
        {book.status === "processing" ? " — the rest are still being written." : "."}
        {book.totalChapters > 1 ? ` New chapters reach your feed ${book.paceChaptersPerCycle} a day; you can also read ahead here.` : ""}
      </p>
      <ol className="mt-6 space-y-2">
        {book.chapters.map((c) => (
          <li key={c.id}>
            {c.hasContent ? (
              <Link href={`/library/chapter/${c.id}`} className="card flex items-center gap-3 !p-4 transition hover:border-neuron-accent">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neuron-surface2 text-sm font-extrabold">{c.chapterNumber}</span>
                <span className="flex-1 font-bold leading-snug">{c.title}</span>
                {c.status === "surfaced" && <span className="pill !border-neuron-accent3/50 !text-neuron-accent3">Read</span>}
              </Link>
            ) : (
              <div className="card flex items-center gap-3 !p-4 opacity-60">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neuron-surface2 text-sm font-extrabold">{c.chapterNumber}</span>
                <span className="flex-1 font-bold leading-snug">{c.title}</span>
                <span className="pill">Notes pending</span>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

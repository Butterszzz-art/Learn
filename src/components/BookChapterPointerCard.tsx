import Link from "next/link";
import type { BookChapterPointer } from "@/lib/digest";

/** A short, lightweight pointer — NOT the chapter content itself. Chapters
 * are a denser reading format that belongs in Library, not embedded in the
 * main feed (same reasoning as Drills getting their own space). */
export function BookChapterPointerCard({ entry }: { entry: BookChapterPointer }) {
  const label =
    entry.chapterNumbers.length === 1
      ? `Chapter ${entry.chapterNumbers[0]}`
      : `Chapters ${entry.chapterNumbers.join(", ")}`;
  const firstChapterId = entry.chapterIds[0];

  return (
    <Link
      href={`/library/chapter/${firstChapterId}`}
      className="card mb-4 block border-neuron-accent3/40 bg-gradient-to-br from-neuron-surface to-neuron-surface2 transition hover:border-neuron-accent3"
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">📚</span>
        <p className="text-sm">
          <span className="font-semibold text-neuron-accent3">
            {label} of {entry.bookTitle}
          </span>{" "}
          is ready — read it in Library →
        </p>
      </div>
    </Link>
  );
}

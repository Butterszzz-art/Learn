import Link from "next/link";
import { notFound } from "next/navigation";
import { getChapterById } from "@/lib/digest";
import { ExplainItBack } from "@/components/ExplainItBack";
import { ExportButtons } from "@/components/ExportButtons";

export const dynamic = "force-dynamic";

export default async function ChapterPage({ params }: { params: { chapterId: string } }) {
  const id = Number(params.chapterId);
  if (!Number.isFinite(id)) notFound();

  const chapter = await getChapterById(id);
  if (!chapter) notFound();

  return (
    <div>
      <Link
        href={`/library/${chapter.bookId}`}
        className="mb-4 inline-block text-xs text-neuron-muted hover:text-neuron-text"
      >
        ← Back to {chapter.bookTitle}
      </Link>

      <div className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="pill border-neuron-accent3/50 text-neuron-accent3">📖 Library</span>
          <span className="pill">{chapter.bookTitle}</span>
          <span className="pill">Chapter {chapter.chapterNumber}</span>
        </div>
        <h1 className="mb-3 font-display text-3xl font-bold leading-tight">{chapter.title}</h1>
        <ExportButtons kind="chapter" id={chapter.id} />
      </div>

      <article className="prose prose-invert max-w-none">
        {chapter.summary?.split("\n\n").map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </article>

      {chapter.keyConcepts.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neuron-muted">
            Key concepts
          </h2>
          <div className="space-y-2">
            {chapter.keyConcepts.map((c, i) => (
              <div key={i} className="card">
                <p className="font-medium">{c.term}</p>
                <p className="mt-0.5 text-sm text-neuron-text/80">{c.definition}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {chapter.notableArguments.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neuron-muted">
            Notable arguments
          </h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-neuron-text/90">
            {chapter.notableArguments.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {chapter.quotes.length > 0 && (
        <div className="mt-8 border-t border-neuron-border pt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neuron-muted">
            Standout lines
          </h2>
          <ul className="space-y-1.5">
            {chapter.quotes.map((q, i) => (
              <li key={i} className="italic text-neuron-text/80">
                "{q}"
              </li>
            ))}
          </ul>
        </div>
      )}

      <ExplainItBack
        source={{ type: "chapter", id: chapter.id }}
        prompt="Explain this chapter back in your own words."
        initialEntries={chapter.explainBacks}
      />
    </div>
  );
}

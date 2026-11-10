import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getChapterById, markChapterOpened } from "@/lib/content";
import { Markdown } from "@/components/Markdown";
import { ExplainItBack } from "@/components/ExplainItBack";
import { ExportButtons } from "@/components/ExportButtons";

export const dynamic = "force-dynamic";

export default async function ChapterPage({ params }: { params: { chapterId: string } }) {
  const user = await requireUser();
  const id = Number(params.chapterId);
  const chapter = await getChapterById(id, user.id);
  if (!chapter) notFound();
  await markChapterOpened(id, user.id);
  return (
    <article>
      <Link href={`/library/${chapter.bookId}`} className="text-sm font-bold text-neuron-accent">← {chapter.bookTitle}</Link>
      <p className="eyebrow mt-4">Chapter {chapter.chapterNumber}</p>
      <h1 className="page-title mt-1">{chapter.title}</h1>
      <p className="mt-2 text-xs text-neuron-muted">AI-written notes on your own upload. Check anything important against the book.</p>

      <Markdown className="mt-6">{chapter.summary ?? ""}</Markdown>

      {chapter.keyConcepts.length > 0 && (
        <section className="mt-8">
          <h2 className="eyebrow mb-3">Key concepts</h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            {chapter.keyConcepts.map((c) => (
              <div key={c.term} className="card !p-4">
                <dt className="font-bold">{c.term}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-neuron-muted">{c.definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {chapter.notableArguments.length > 0 && (
        <section className="mt-8">
          <h2 className="eyebrow mb-3">Notable arguments</h2>
          <ul className="space-y-2">
            {chapter.notableArguments.map((a, i) => <li key={i} className="card !p-4 leading-relaxed">{a}</li>)}
          </ul>
        </section>
      )}
      {chapter.quotes.length > 0 && (
        <section className="mt-8">
          <h2 className="eyebrow mb-3">In the author's words</h2>
          <ul className="space-y-2">
            {chapter.quotes.map((q, i) => <li key={i} className="border-l-4 border-neuron-accent pl-4 italic text-neuron-text/90">“{q}”</li>)}
          </ul>
        </section>
      )}
      <ExplainItBack source={{ type: "chapter", id: chapter.id }} prompt="Explain this chapter back in your own words." initialEntries={chapter.explainBacks} />
      <footer className="mt-10 border-t border-neuron-border pt-5"><ExportButtons kind="chapter" id={chapter.id} /></footer>
    </article>
  );
}

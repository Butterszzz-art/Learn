import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getDeepDiveDetail, markDeepDiveOpened } from "@/lib/content";
import { getUserInterest } from "@/lib/interests";
import { LEVEL_LABELS } from "@/db/schema";
import { formatDate, readingMinutes } from "@/lib/ui";
import { Markdown } from "@/components/Markdown";
import { FollowUpCards } from "@/components/FollowUpCards";
import { ExplainItBack } from "@/components/ExplainItBack";
import { ExportButtons } from "@/components/ExportButtons";
import { DeepDiveQuiz, DeepDiveTools } from "@/components/DeepDiveExtras";

export const dynamic = "force-dynamic";

export default async function DeepDivePage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();
  const dive = await getDeepDiveDetail(id, user.id);
  if (!dive || (dive.status === "flagged" && user.role !== "admin")) notFound();
  await markDeepDiveOpened(id, user.id);
  const follows = await getUserInterest(user.id, dive.interestId);

  // Quiz cards are saved per answer; older entries only have the unsaved self-check list.
  const quiz =
    dive.quizCards.length > 0
      ? dive.quizCards
      : dive.selfCheckQuestions.map((q) => ({ cardId: null, ...q }));

  return (
    <article>
      <Link href="/" className="text-sm font-bold text-neuron-accent">← Feed</Link>
      {dive.status === "flagged" && (
        <p className="mt-3 rounded-2xl border border-neuron-warn/50 bg-neuron-warn/10 p-3 text-sm font-semibold text-neuron-warn">
          Unpublished: this entry failed the source check and only admins can see it.
        </p>
      )}
      <header className="mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="pill !text-neuron-text">{dive.interestName}</span>
          <span className="pill">{LEVEL_LABELS[dive.level]}</span>
          <span className="text-xs text-neuron-muted">{readingMinutes(dive.content)} min read · {formatDate(dive.createdAt)}</span>
        </div>
        <h1 className="mt-3 font-display text-3xl font-bold leading-tight sm:text-4xl">{dive.topic}</h1>
        <p className="mt-2 text-xs text-neuron-muted">Written by AI from the sources listed below, then checked against them automatically. Spot a mistake? Report it.</p>
        <div className="mt-4"><DeepDiveTools deepDiveId={dive.id} speechText={dive.content.replace(/[#*_>\[\]()]/g, "")} /></div>
      </header>

      {dive.takeaways.length > 0 && (
        <section className="mt-6 rounded-3xl border border-neuron-border bg-neuron-surface p-5" aria-labelledby="key-points">
          <h2 id="key-points" className="eyebrow mb-3">The short version</h2>
          <ul className="space-y-2">
            {dive.takeaways.map((t) => (
              <li key={t} className="flex gap-2 font-semibold leading-snug"><span aria-hidden className="text-neuron-accent">•</span>{t}</li>
            ))}
          </ul>
        </section>
      )}

      <Markdown className="mt-8">{dive.content}</Markdown>

      {dive.appliedInsight && (
        <section className="mt-8 rounded-3xl border-2 border-neuron-accent3/40 bg-neuron-accent3/10 p-5">
          <h2 className="eyebrow mb-2 !text-neuron-accent3">Try this</h2>
          <p className="leading-relaxed">{dive.appliedInsight}</p>
        </section>
      )}

      {dive.concepts.length > 0 && (
        <section className="mt-8" aria-labelledby="concepts-heading">
          <h2 id="concepts-heading" className="eyebrow mb-3">Ideas in this entry</h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            {dive.concepts.map((c) => (
              <div key={c.id} className="card !p-4">
                <dt className="font-bold">{c.name}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-neuron-muted">{c.definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {dive.sources.length > 0 && (
        <section className="mt-10 border-t border-neuron-border pt-6" aria-labelledby="sources-heading">
          <h2 id="sources-heading" className="eyebrow mb-3">Sources</h2>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            {dive.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-neuron-accent">{s.title}</a>
                <span className="ml-1 text-xs text-neuron-muted">{hostOf(s.url)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <DeepDiveQuiz questions={quiz} />
      <ExplainItBack source={{ type: "deepDive", id: dive.id }} prompt={dive.essayPrompt ?? "Explain this back in your own words, as if to a friend."} initialEntries={dive.explainBacks} />
      {follows?.enabled && <FollowUpCards interestId={dive.interestId} topics={dive.followUpTopics} allowPick />}

      <footer className="mt-10 border-t border-neuron-border pt-5"><ExportButtons kind="deep-dive" id={dive.id} /></footer>
    </article>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

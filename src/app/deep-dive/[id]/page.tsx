import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getDeepDiveById } from "@/lib/digest";
import { LEVEL_LABELS } from "@/db/schema";
import { AppliedInsightCard } from "@/components/AppliedInsightCard";
import { FollowUpCards } from "@/components/FollowUpCards";
import { SelfCheckQuiz } from "@/components/SelfCheckQuiz";
import { ExplainItBack } from "@/components/ExplainItBack";

export const dynamic = "force-dynamic";

export default async function DeepDivePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { from?: string; next?: string };
}) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  const deepDive = await getDeepDiveById(id);
  if (!deepDive) notFound();

  const createdAt = new Date(deepDive.createdAt);
  const createdLabel = isNaN(createdAt.getTime())
    ? ""
    : createdAt.toLocaleDateString(undefined, { dateStyle: "medium" });

  // Opened as a hook card from the reading stream (Phase 8): closing this
  // should return to the stream at the NEXT card, not back at this same hook.
  const backHref = searchParams.from === "stream" && searchParams.next ? `/?at=${encodeURIComponent(searchParams.next)}` : "/";

  return (
    <div>
      <Link href={backHref} className="mb-4 inline-block text-xs text-neuron-muted hover:text-neuron-text">
        ← Back to feed
      </Link>

      <div className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="pill border-neuron-accent2/50 text-neuron-accent2">📖 Deep dive</span>
          <span className="pill">{deepDive.interestName}</span>
          <span className="pill">{LEVEL_LABELS[deepDive.level]}</span>
          {createdLabel && <span className="text-neuron-muted">{createdLabel}</span>}
        </div>
        <h1 className="font-display text-3xl font-bold leading-tight">{deepDive.topic}</h1>
      </div>

      <article className="prose prose-invert max-w-none prose-headings:font-display prose-a:text-neuron-accent prose-strong:text-neuron-text">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{deepDive.content}</ReactMarkdown>
      </article>

      {deepDive.appliedInsight && (
        <div className="mt-8">
          <AppliedInsightCard entry={{ id: deepDive.id, content: deepDive.appliedInsight, createdAt: deepDive.createdAt }} />
        </div>
      )}

      {deepDive.sources.length > 0 && (
        <div className="mt-10 border-t border-neuron-border pt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neuron-muted">
            Sources
          </h2>
          <ul className="space-y-1.5 text-sm">
            {deepDive.sources.map((source, i) => (
              <li key={i}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-neuron-accent hover:underline"
                >
                  {source.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <SelfCheckQuiz questions={deepDive.selfCheckQuestions} />
      <ExplainItBack
        source={{ type: "deepDive", id: deepDive.id }}
        prompt={deepDive.essayPrompt || "Explain this back in your own words."}
        initialEntries={deepDive.explainBacks}
      />
      <FollowUpCards interestId={deepDive.interestId} topics={deepDive.followUpTopics} />
    </div>
  );
}

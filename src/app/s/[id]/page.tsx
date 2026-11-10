import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ensureDb } from "@/db/bootstrap";
import { getPublicCard } from "@/lib/publicCard";
import { interestStyle } from "@/lib/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  await ensureDb();
  const card = await getPublicCard(Number(params.id));
  if (!card) return { title: "Neuron" };
  const description = (card.takeaway ?? card.body).slice(0, 180);
  return {
    title: card.title,
    description,
    openGraph: { title: card.title, description, images: [`/api/og/${card.id}`], type: "article" },
    twitter: { card: "summary_large_image", title: card.title, description, images: [`/api/og/${card.id}`] },
  };
}

/** Public page for a shared card: the card itself, and a way in. */
export default async function SharedCardPage({ params }: { params: { id: string } }) {
  await ensureDb();
  const card = await getPublicCard(Number(params.id));
  if (!card) notFound();
  return (
    <div className="flex min-h-[85dvh] flex-col justify-center" style={interestStyle(card.interestId)}>
      <article className="card !p-7">
        {card.interestName && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ic-soft)] px-3 py-1 text-xs font-extrabold">
            <span aria-hidden className="h-2 w-2 rounded-full bg-[var(--ic)]" />
            {card.interestName}
          </span>
        )}
        <h1 className="mt-4 font-display text-3xl font-bold leading-tight">{card.title}</h1>
        <p className="mt-4 text-lg leading-relaxed">{card.body}</p>
        {card.takeaway && card.type !== "paper" && <p className="mt-4 border-l-4 border-[var(--ic)] pl-4 font-bold">{card.takeaway}</p>}
        {card.sourceUrl && (
          <a href={card.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block text-sm font-extrabold text-neuron-accent">
            Source: {card.sourceName ?? "link"} ↗
          </a>
        )}
      </article>
      <div className="mt-6 text-center">
        <p className="font-display text-xl font-bold">🧠 Neuron</p>
        <p className="mt-1 text-neuron-muted">A swipe feed where every card teaches you something real.</p>
        <Link href="/signup" className="btn-primary mt-4">Start learning — free</Link>
      </div>
    </div>
  );
}

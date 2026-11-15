import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getSavedCards } from "@/lib/feed";
import { CARD_KIND_LABELS } from "@/lib/cardTypes";
import { interestStyle } from "@/lib/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Saved" };

export default async function SavedPage() {
  const user = await requireUser();
  const cards = await getSavedCards(user.id);
  return (
    <div>
      <Link href="/me" className="text-sm font-bold text-neuron-accent">← Me</Link>
      <h1 className="page-title mt-4">Saved</h1>
      {cards.length === 0 ? (
        <p className="mt-3 text-neuron-muted">Tap Save on any card to keep it here.</p>
      ) : (
        <ul className="mt-5 space-y-2">
          {cards.map((c) => (
            <li key={c.key} style={interestStyle(c.interestId)}>
              <Link href={`/card/${c.cardId}`} className="card block !p-4 transition hover:border-neuron-accent">
                <span className="eyebrow">{CARD_KIND_LABELS[c.kind]}{c.interestName ? ` · ${c.interestName}` : ""}</span>
                <span className="mt-1 block font-bold leading-snug">{c.title}</span>
                <span className="mt-1 line-clamp-2 block text-sm text-neuron-muted">{c.body}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { buildReviewCards } from "@/lib/feed";
import { countDue } from "@/lib/learning";
import { getPracticeCards } from "@/lib/explore";
import { ReviewSession } from "@/components/ReviewSession";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review" };

export default async function ReviewPage({ searchParams }: { searchParams: { mode?: string } }) {
  const user = await requireUser();
  const practice = searchParams.mode === "practice";
  const [due, cards] = await Promise.all([
    countDue(user.id),
    practice ? getPracticeCards(user.id, 10) : buildReviewCards(user.id, 15, new Set()),
  ]);
  return (
    <div>
      <h1 className="page-title">Review</h1>
      <p className="mt-1 text-neuron-muted">
        {due > 0 ? `${due} idea${due === 1 ? "" : "s"} due. Recalling them now is what makes them stick.` : "Nothing is due. Reviews appear when an idea is about to fade."}
      </p>
      <div className="mb-5 mt-4 flex gap-2" role="tablist" aria-label="Review mode">
        <Link href="/review" role="tab" aria-selected={!practice} className={`pill !py-1.5 ${!practice ? "!border-neuron-accent !bg-neuron-accent/15 !text-neuron-text" : ""}`}>Due now{due > 0 ? ` (${due})` : ""}</Link>
        <Link href="/review?mode=practice" role="tab" aria-selected={practice} className={`pill !py-1.5 ${practice ? "!border-neuron-accent !bg-neuron-accent/15 !text-neuron-text" : ""}`}>Extra practice</Link>
      </div>
      <ReviewSession
        cards={cards}
        emptyTitle={practice ? "No practice questions yet" : "All caught up"}
        emptyText={practice ? "Questions appear here for entries you've started reading." : "Come back later — or try some extra practice."}
      />
    </div>
  );
}

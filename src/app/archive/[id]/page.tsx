import Link from "next/link";
import { notFound } from "next/navigation";
import { getFeedByCycleId } from "@/lib/digest";
import { getAllInterests } from "@/lib/interests";
import { buildReadingStream } from "@/lib/stream";
import { StreamContainer } from "@/components/stream/StreamContainer";

export const dynamic = "force-dynamic";

export default async function ArchiveCyclePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { at?: string };
}) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  // Archive view shows everything that was compiled into this historical
  // cycle, regardless of which interests are enabled *now* — and, per
  // Phase 8, reads through the same Focus/Overview reader as the live feed.
  const allInterests = await getAllInterests();
  const feed = await getFeedByCycleId(id, allInterests.map((i) => i.id));
  if (!feed) notFound();

  const createdAt = new Date(feed.createdAt);
  const createdLabel = isNaN(createdAt.getTime())
    ? ""
    : createdAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div>
      <Link href="/archive" className="mb-4 inline-block text-xs text-neuron-muted hover:text-neuron-text">
        ← Back to archive
      </Link>
      <StreamContainer
        cards={buildReadingStream(feed, true)}
        interestPills={feed.sections.map((s) => ({ id: s.interestId, name: s.interestName, isFavorite: s.isFavorite }))}
        periodLabel={feed.periodLabel}
        frequency={feed.frequency}
        totalEntries={feed.totalEntries}
        createdLabel={createdLabel}
        initialCardId={searchParams.at}
      />
    </div>
  );
}

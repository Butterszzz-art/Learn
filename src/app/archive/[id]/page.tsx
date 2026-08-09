import Link from "next/link";
import { notFound } from "next/navigation";
import { getFeedByCycleId } from "@/lib/digest";
import { getAllInterests } from "@/lib/interests";
import { Feed } from "@/components/Feed";

export const dynamic = "force-dynamic";

export default async function ArchiveCyclePage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  // Archive view shows everything that was compiled into this historical
  // cycle, regardless of which interests are enabled *now*.
  const allInterests = await getAllInterests();
  const feed = await getFeedByCycleId(id, allInterests.map((i) => i.id));
  if (!feed) notFound();

  return (
    <div>
      <Link href="/archive" className="mb-4 inline-block text-xs text-neuron-muted hover:text-neuron-text">
        ← Back to archive
      </Link>
      <Feed feed={feed} isArchive />
    </div>
  );
}

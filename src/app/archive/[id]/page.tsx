import Link from "next/link";
import { notFound } from "next/navigation";
import { getDigestById } from "@/lib/digest";
import { DigestView } from "@/components/DigestView";

export const dynamic = "force-dynamic";

export default async function ArchiveDigestPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  const digest = await getDigestById(id);
  if (!digest) notFound();

  return (
    <div>
      <Link href="/archive" className="mb-4 inline-block text-xs text-brain-muted hover:text-brain-text">
        ← Back to archive
      </Link>
      <DigestView digest={digest} />
    </div>
  );
}

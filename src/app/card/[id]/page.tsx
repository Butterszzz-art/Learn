import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getCardById } from "@/lib/feed";
import { SingleCard } from "@/components/SingleCard";

export const dynamic = "force-dynamic";

export default async function CardPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const card = await getCardById(Number(params.id), user.id);
  if (!card) notFound();
  return (
    <div>
      <Link href="/" className="text-sm font-bold text-neuron-accent">← Feed</Link>
      <div className="mt-4"><SingleCard card={card} /></div>
    </div>
  );
}

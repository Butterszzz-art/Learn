import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getEnabledInterests } from "@/lib/interests";
import { getKnowledgeMap } from "@/lib/learning";
import { client } from "@/db";
import { KnowledgeMap } from "@/components/KnowledgeMap";

export const dynamic = "force-dynamic";
export const metadata = { title: "Knowledge map" };

export default async function MapPage() {
  const user = await requireUser();
  const interests = await getEnabledInterests(user.id);
  // Include the hidden per-book interests so Library concepts get their own tab.
  const lib = await client.execute({
    sql: "SELECT DISTINCT interest_id FROM concepts WHERE owner_user_id = ?",
    args: [user.id],
  });
  const ids = [...interests.map((i) => i.id), ...(lib.rows as any[]).map((r) => Number(r.interest_id))];
  const fields = await getKnowledgeMap(user.id, ids);
  return (
    <div>
      <Link href="/me" className="text-sm font-bold text-neuron-accent">← Me</Link>
      <h1 className="page-title mt-4">Knowledge map</h1>
      <p className="mb-6 mt-1 text-neuron-muted">Every idea in your fields, from foundations up. Filled in means you've recalled it after time has passed — tap any idea to see what it builds on.</p>
      <KnowledgeMap fields={fields} />
    </div>
  );
}

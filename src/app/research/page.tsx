import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { hasOpenRouterKey } from "@/lib/researchAgent";
import { ResearchAgent } from "@/components/ResearchAgent";

export const dynamic = "force-dynamic";
export const metadata = { title: "Research" };

export default async function ResearchPage() {
  await requireUser();
  return (
    <div>
      <Link href="/explore" className="text-sm font-bold text-neuron-accent">← Explore</Link>
      <h1 className="page-title mt-4">Research Agent</h1>
      <p className="mb-6 mt-1 text-neuron-muted">
        Ask a question and it searches OpenAlex and Semantic Scholar for real papers before answering, citing what it actually found.
      </p>
      {hasOpenRouterKey() ? <ResearchAgent /> : <p className="card text-sm text-neuron-muted">The Research Agent isn't configured on this server.</p>}
    </div>
  );
}

import { redirect } from "next/navigation";
import Link from "next/link";
import { hasCompletedOnboarding, getEnabledInterests } from "@/lib/interests";
import { getCurrentFeed } from "@/lib/digest";
import { Feed } from "@/components/Feed";
import { RefreshButton } from "@/components/RefreshButton";
import { hasClaudeKey } from "@/lib/claude";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const onboarded = await hasCompletedOnboarding();
  if (!onboarded) redirect("/onboarding");

  const enabledInterests = await getEnabledInterests();
  const feed = await getCurrentFeed(enabledInterests.map((i) => i.id));
  const claudeConfigured = hasClaudeKey();

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="max-w-md">
          {!claudeConfigured && (
            <p className="mb-2 text-xs text-brain-muted">
              No <code>ANTHROPIC_API_KEY</code> set — deep dives are skipped; curated items still
              work. See the README to enable them.
            </p>
          )}
          <Link href="/settings" className="text-xs text-brain-muted hover:text-brain-text">
            {enabledInterests.length} interest{enabledInterests.length === 1 ? "" : "s"} enabled · edit
            in Settings →
          </Link>
        </div>
        <RefreshButton />
      </div>

      {feed ? (
        <Feed feed={feed} />
      ) : (
        <div className="card text-center">
          <p className="mb-2 text-lg font-medium">No cycle yet</p>
          <p className="text-sm text-brain-muted">
            Click "Refresh now" to fetch curated items and generate your first deep dives.
          </p>
        </div>
      )}
    </div>
  );
}

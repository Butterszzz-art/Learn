import { getLatestDigest } from "@/lib/digest";
import { DigestView } from "@/components/DigestView";
import { RefreshButton } from "@/components/RefreshButton";
import { hasClaudeKey } from "@/lib/claude";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const digest = await getLatestDigest();
  const claudeConfigured = hasClaudeKey();

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          {!claudeConfigured && (
            <p className="mb-2 max-w-md text-xs text-brain-muted">
              No <code>ANTHROPIC_API_KEY</code> set — running in keyword-sorting mode with
              truncated-snippet summaries. See the README to enable AI summaries.
            </p>
          )}
        </div>
        <RefreshButton />
      </div>

      {digest ? (
        <DigestView digest={digest} />
      ) : (
        <div className="card text-center">
          <p className="mb-2 text-lg font-medium">No digest yet</p>
          <p className="text-sm text-brain-muted">
            Click "Refresh now" to fetch the latest neuroscience news and compile your first digest.
          </p>
        </div>
      )}
    </div>
  );
}

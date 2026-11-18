import { requireUser } from "@/lib/auth";
import { getFeedPage } from "@/lib/feed";
import { getEnabledInterests } from "@/lib/interests";
import { FeedClient } from "@/components/feed/FeedClient";
import { getActiveMuteNotices } from "@/lib/mutes";
import { getDailyState } from "@/lib/daily";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();
  // The first page is rendered on the server, so the first card is on
  // screen with the initial HTML rather than after a client fetch.
  const [page, interests, daily] = await Promise.all([getFeedPage(user, { count: 10 }), getEnabledInterests(user.id), getDailyState(user)]);
  // Read after the feed is built: building it may have just added a notice.
  const muteNotices = await getActiveMuteNotices(user.id);
  return (
    <FeedClient
      initialCards={page.cards}
      initialHasMore={page.hasMore}
      interests={interests.map((i) => ({ id: i.id, name: i.name }))}
      muteNotices={muteNotices}
      daily={daily}
      summaryLength={user.prefs.summaryLength}
    />
  );
}

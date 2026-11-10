import { requireUser } from "@/lib/auth";
import { getFeedPage } from "@/lib/feed";
import { getEnabledInterests } from "@/lib/interests";
import { FeedClient } from "@/components/feed/FeedClient";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();
  // The first page is rendered on the server, so the first card is on
  // screen with the initial HTML rather than after a client fetch.
  const [page, interests] = await Promise.all([getFeedPage(user, { count: 10 }), getEnabledInterests(user.id)]);
  return (
    <FeedClient
      initialCards={page.cards}
      initialHasMore={page.hasMore}
      interests={interests.map((i) => ({ id: i.id, name: i.name }))}
    />
  );
}

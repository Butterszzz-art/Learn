import type {
  CycleFeed,
  NewsItem,
  AppliedInsightSummary,
  DeepDiveSummary,
  MentalModelOfTheDay,
  RabbitHoleOfTheDay,
  DueReviewTopic,
  BookChapterPointer,
} from "./digest";
import type { BrainGamePick } from "./brainGames";

/**
 * Phase 8 — Unified Swipe Stream. A single ordered array of "reading-format"
 * content, flattened out of the same CycleFeed the old grouped-by-interest
 * layout used (no new queries — see buildReadingStream below). Drills and
 * Library chapters are deliberately NOT card kinds here; they get lightweight
 * pointer cards instead and live in their own tabs.
 */
export type StreamCard =
  | { id: string; kind: "rememberThis"; interestName?: undefined; data: DueReviewTopic }
  | { id: string; kind: "brainFact"; interestName?: undefined; data: { text: string; topic: string | null } }
  | { id: string; kind: "mentalModel"; interestName?: undefined; data: MentalModelOfTheDay }
  | { id: string; kind: "rabbitHole"; interestName?: undefined; data: RabbitHoleOfTheDay }
  | { id: string; kind: "news"; interestName: string; data: NewsItem }
  | { id: string; kind: "appliedInsight"; interestName: string; data: AppliedInsightSummary }
  | { id: string; kind: "deepDiveHook"; interestName: string; data: DeepDiveSummary }
  | { id: string; kind: "brainGame"; interestName?: undefined; data: BrainGamePick }
  | { id: string; kind: "drillPointer"; interestName?: undefined; count: number }
  | { id: string; kind: "chapterPointer"; interestName?: undefined; data: BookChapterPointer }
  | {
      id: string;
      kind: "caughtUp";
      interestName?: undefined;
      conceptsThisMonth: number;
      interestsCount: number;
      frequency: string;
    };

interface QueueItem {
  card: StreamCard;
  weight: 1 | 2; // 1 = short/self-contained, 2 = long-form (deep dive hook)
}

/**
 * Flattens a CycleFeed into one ordered stream, per the Phase 8 ordering
 * rules: due "Remember this?" appears first; Mental Model of the Day gets an
 * early, clearly-placed slot; favorited interests' content is interleaved
 * more densely (roughly 2:1) than non-favorited; short and long-form cards
 * are interleaved so several Deep Dive hooks don't cluster back to back;
 * Rabbit Hole of the Day gets a clearly-placed slot around the midpoint;
 * Brain Games (if enabled) and the Drills/Library pointer cards come near
 * the end; it always ends with a "caught up" card.
 *
 * `isArchive` mirrors the old Feed.tsx's gating: "live" state (due review,
 * brain games) only makes sense on the current cycle, not a historical one.
 */
export function buildReadingStream(feed: CycleFeed, isArchive: boolean): StreamCard[] {
  const cards: StreamCard[] = [];

  if (!isArchive && feed.dueReview) {
    cards.push({ id: `remember-${feed.dueReview.coveredTopicId}`, kind: "rememberThis", data: feed.dueReview });
  }
  if (feed.showBrainFact && feed.brainFact) {
    cards.push({ id: `brainfact-${feed.cycleId}`, kind: "brainFact", data: feed.brainFact });
  }
  if (feed.mentalModelOfTheDay) {
    cards.push({ id: `mentalmodel-${feed.mentalModelOfTheDay.id}`, kind: "mentalModel", data: feed.mentalModelOfTheDay });
  }

  const favoriteQueues: QueueItem[][] = [];
  const normalQueues: QueueItem[][] = [];

  for (const section of feed.sections) {
    const queue: QueueItem[] = [];
    for (const item of section.news) {
      queue.push({
        card: { id: `news-${item.id}`, kind: "news", interestName: section.interestName, data: item },
        weight: 1,
      });
    }
    for (const insight of section.appliedInsights) {
      queue.push({
        card: { id: `insight-${insight.id}`, kind: "appliedInsight", interestName: section.interestName, data: insight },
        weight: 1,
      });
    }
    for (const dive of section.deepDives) {
      queue.push({
        card: { id: `dive-${dive.id}`, kind: "deepDiveHook", interestName: section.interestName, data: dive },
        weight: 2,
      });
    }
    if (queue.length === 0) continue;
    (section.isFavorite ? favoriteQueues : normalQueues).push(queue);
  }

  // Weighted round-robin: favorited interests' queues contribute up to 2
  // cards per round, non-favorited 1 — denser representation rather than a
  // blunt "all favorites first" sort.
  const mainItems: QueueItem[] = [];
  const allQueues = [...favoriteQueues, ...normalQueues];
  let round = 0;
  while (allQueues.some((q) => q.length > 0)) {
    for (const q of favoriteQueues) {
      for (let k = 0; k < 2 && q.length > 0; k++) mainItems.push(q.shift()!);
    }
    for (const q of normalQueues) {
      if (q.length > 0) mainItems.push(q.shift()!);
    }
    round++;
    if (round > 1000) break; // safety valve, should never trigger
  }

  // Interleave short/long so deep dive hooks don't cluster.
  const shortCards = mainItems.filter((i) => i.weight === 1).map((i) => i.card);
  const longCards = mainItems.filter((i) => i.weight === 2).map((i) => i.card);
  const interleaved: StreamCard[] = [];
  const SHORTS_PER_LONG = 3;
  let si = 0;
  let li = 0;
  while (si < shortCards.length || li < longCards.length) {
    for (let k = 0; k < SHORTS_PER_LONG && si < shortCards.length; k++) interleaved.push(shortCards[si++]);
    if (li < longCards.length) interleaved.push(longCards[li++]);
  }

  // Rabbit Hole of the Day: one clearly-placed slot near the midpoint of the
  // main interleaved content (not randomly mixed in with the round-robin).
  if (feed.rabbitHoleOfTheDay) {
    const midpoint = Math.floor(interleaved.length / 2);
    interleaved.splice(midpoint, 0, { id: `rabbithole-${feed.rabbitHoleOfTheDay.id}`, kind: "rabbitHole", data: feed.rabbitHoleOfTheDay });
  }

  cards.push(...interleaved);

  // Brain Games: individual cards (not a grouped section) — only on the live
  // feed, same "today's picks" reasoning as dueReview above.
  if (!isArchive && feed.brainGames) {
    for (const game of feed.brainGames) {
      cards.push({ id: `braingame-${game.id}`, kind: "brainGame", data: game });
    }
  }

  // Lightweight pointers to Drills/Library — never the content itself.
  const totalDrills = feed.sections.reduce((sum, s) => sum + s.drills.length, 0);
  if (totalDrills > 0) {
    cards.push({ id: "drill-pointer", kind: "drillPointer", count: totalDrills });
  }
  for (const pointer of feed.bookChaptersOfTheDay) {
    cards.push({ id: `chapter-pointer-${pointer.bookId}`, kind: "chapterPointer", data: pointer });
  }

  cards.push({
    id: "caught-up",
    kind: "caughtUp",
    conceptsThisMonth: feed.progress.conceptsThisMonth,
    interestsCount: feed.progress.interestsCount,
    frequency: feed.frequency,
  });

  return cards;
}

/** All distinct interest names represented in the stream, in first-seen
 * order — feeds the filter pills row. */
export function streamInterestNames(cards: StreamCard[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const card of cards) {
    if (card.interestName && !seen.has(card.interestName)) {
      seen.add(card.interestName);
      names.push(card.interestName);
    }
  }
  return names;
}

const KIND_ICON: Record<StreamCard["kind"], string> = {
  rememberThis: "🧠",
  brainFact: "✨",
  mentalModel: "🔎",
  rabbitHole: "🕳️",
  news: "📰",
  appliedInsight: "💡",
  deepDiveHook: "📖",
  brainGame: "🎮",
  drillPointer: "🧩",
  chapterPointer: "📚",
  caughtUp: "✓",
};

export function streamCardIcon(card: StreamCard): string {
  return KIND_ICON[card.kind];
}

/** One-line title + snippet for Overview mode's scannable list. */
export function streamCardPreview(card: StreamCard): { title: string; snippet: string } {
  switch (card.kind) {
    case "rememberThis":
      return { title: `Remember this? — ${card.data.topic}`, snippet: card.data.interestName };
    case "brainFact":
      return { title: "Brain Fact of the Day", snippet: card.data.text };
    case "mentalModel":
      return { title: `Mental Model: ${card.data.modelName}`, snippet: card.data.lensText };
    case "rabbitHole":
      return { title: card.data.title, snippet: card.data.summary };
    case "news":
      return { title: card.data.title, snippet: card.data.summary };
    case "appliedInsight":
      return { title: `Applied Insight — ${card.interestName}`, snippet: card.data.content };
    case "deepDiveHook":
      return { title: card.data.topic, snippet: card.data.contentPreview };
    case "brainGame":
      return { title: "Brain Game", snippet: card.data.content };
    case "drillPointer":
      return { title: `${card.count} drill${card.count === 1 ? "" : "s"} ready`, snippet: "Practice in Drills" };
    case "chapterPointer": {
      const label =
        card.data.chapterNumbers.length === 1
          ? `Chapter ${card.data.chapterNumbers[0]}`
          : `Chapters ${card.data.chapterNumbers.join(", ")}`;
      return { title: `${label} of ${card.data.bookTitle}`, snippet: "Read it in Library" };
    }
    case "caughtUp":
      return { title: "You're caught up", snippet: `That's everything for this ${card.frequency === "daily" ? "day" : "week"}'s cycle.` };
  }
}

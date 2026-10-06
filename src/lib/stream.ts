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
 *
 * Phase 13 (Hybrid Cadence): the flattened array is now built in two blocks
 * — a daily block (News, plus the daily-cadence rememberThis/brainFact) and
 * a weekly block (everything else) — rather than one interleaved pass. Each
 * kind has a fixed cadence (see cardCadence below), used by the home page to
 * decide what's still "new" to the reader on each visit.
 */
export type StreamCard =
  | { id: string; kind: "rememberThis"; interestName?: undefined; data: DueReviewTopic }
  | { id: string; kind: "brainFact"; interestName?: undefined; data: { text: string; topic: string | null } }
  | { id: string; kind: "mentalModel"; interestName?: undefined; data: MentalModelOfTheDay }
  | { id: string; kind: "rabbitHole"; interestName?: undefined; data: RabbitHoleOfTheDay }
  // Phase 14: interestId is carried alongside interestName purely so the
  // engagement-event logger (ViewTracker) knows which interest to
  // attribute a "viewed" event to for pruning purposes.
  | { id: string; kind: "news"; interestName: string; interestId: number; data: NewsItem }
  | { id: string; kind: "appliedInsight"; interestName: string; interestId: number; data: AppliedInsightSummary }
  | { id: string; kind: "deepDiveHook"; interestName: string; interestId: number; data: DeepDiveSummary }
  | { id: string; kind: "brainGame"; interestName?: undefined; data: BrainGamePick }
  | { id: string; kind: "drillPointer"; interestName?: undefined; count: number }
  | { id: string; kind: "chapterPointer"; interestName?: undefined; data: BookChapterPointer }
  // Phase 13: marks the start of an interest's weekly deep-content bundle,
  // right before its interleaved deepDiveHook/appliedInsight cards.
  | { id: string; kind: "weeklyBundleHeader"; interestName: string; count: number }
  | {
      id: string;
      kind: "caughtUp";
      interestName?: undefined;
      conceptsThisMonth: number;
      interestsCount: number;
      // Phase 13: precomputed here (not in CaughtUpCard) so the component
      // stays cadence-agnostic — see caughtUpMessage below.
      message: string;
    };

interface QueueItem {
  card: StreamCard;
  weight: 1 | 2; // 1 = short/self-contained, 2 = long-form (deep dive hook)
}

/** Every StreamCard kind's cadence — daily (News-adjacent, refreshed every
 * day) or weekly (the consolidated deep-content bundle). `caughtUp` has no
 * cadence of its own; it's always shown, handled separately by callers. */
const CADENCE_BY_KIND: Record<Exclude<StreamCard["kind"], "caughtUp">, "daily" | "weekly"> = {
  rememberThis: "daily",
  brainFact: "daily",
  news: "daily",
  mentalModel: "weekly",
  rabbitHole: "weekly",
  appliedInsight: "weekly",
  deepDiveHook: "weekly",
  brainGame: "weekly",
  drillPointer: "weekly",
  chapterPointer: "weekly",
  weeklyBundleHeader: "weekly",
};

export function cardCadence(card: StreamCard): "daily" | "weekly" | null {
  if (card.kind === "caughtUp") return null;
  return CADENCE_BY_KIND[card.kind];
}

/**
 * The subset of `cards` that should be excluded from the default Focus
 * swipe deck — a cadence whose current bundle is already fully seen (see
 * digest.ts's getHybridCurrentFeed). Never used for Overview mode or the
 * interest filter pills, which always show everything (see
 * StreamContainer's hasBrowsedFull) — this only trims the *default* deck.
 */
export function computeHiddenCardIds(
  cards: StreamCard[],
  seen: { dailyFullySeen: boolean; weeklyFullySeen: boolean }
): Set<string> {
  const hidden = new Set<string>();
  for (const card of cards) {
    const cadence = cardCadence(card);
    if (cadence === "daily" && seen.dailyFullySeen) hidden.add(card.id);
    if (cadence === "weekly" && seen.weeklyFullySeen) hidden.add(card.id);
  }
  return hidden;
}

function caughtUpMessage(dailyFullySeen: boolean, weeklyFullySeen: boolean): string {
  if (dailyFullySeen && weeklyFullySeen) {
    return "That's everything for today AND this week. Refresh for new headlines — the weekly bundle regenerates next week.";
  }
  if (weeklyFullySeen) {
    return "That's today's fresh headlines. This week's deep dives and insights are already caught up — browse them anytime via Overview or the interest pills.";
  }
  return "That's everything ready for today's headlines and this week's deep-content bundle. Refresh for new headlines any time.";
}

/** Builds one cadence's queue of per-interest short cards (weight 1), using
 * the same favorite-weighted round robin every cadence block uses: favorited
 * interests contribute up to 2 cards per round, non-favorited 1. */
function roundRobin(favoriteQueues: QueueItem[][], normalQueues: QueueItem[][]): QueueItem[] {
  const out: QueueItem[] = [];
  const allQueues = [...favoriteQueues, ...normalQueues];
  let round = 0;
  while (allQueues.some((q) => q.length > 0)) {
    for (const q of favoriteQueues) {
      for (let k = 0; k < 2 && q.length > 0; k++) out.push(q.shift()!);
    }
    for (const q of normalQueues) {
      if (q.length > 0) out.push(q.shift()!);
    }
    round++;
    if (round > 1000) break; // safety valve, should never trigger
  }
  return out;
}

/**
 * Flattens a CycleFeed into one ordered stream, per the Phase 8 ordering
 * rules (Phase 13 restructured the middle into two cadence blocks — see the
 * module comment above): due "Remember this?" appears first; Mental Model
 * of the Week gets an early, clearly-placed slot; then the DAILY block
 * (News, favorite-weighted round robin); then the WEEKLY block — one "This
 * Week in [Interest]" header per interest with weekly content, followed by
 * that content's short/long-interleaved deep-dive-hook + applied-insight
 * cards so several Deep Dive hooks don't cluster back to back; Rabbit
 * Hole(s) of the Week get a clearly-placed slot around the weekly block's
 * midpoint; Brain Games (if enabled) and the Drills/Library pointer cards
 * come near the end; it always ends with a "caught up" card.
 *
 * `isArchive` mirrors the old Feed.tsx's gating: "live" state (due review,
 * brain games) only makes sense on the current cycle, not a historical one.
 * `seenFlags` (live/home only — see digest.ts's getHybridCurrentFeed) drives
 * the caught-up card's cadence-aware copy; omitted for Archive and any
 * other non-hybrid caller, which get a generic "everything for this cycle"
 * message instead.
 */
export function buildReadingStream(
  feed: CycleFeed,
  isArchive: boolean,
  seenFlags?: { dailyFullySeen: boolean; weeklyFullySeen: boolean }
): StreamCard[] {
  const cards: StreamCard[] = [];

  if (!isArchive && feed.dueReview) {
    cards.push({ id: `remember-${feed.dueReview.coveredTopicId}`, kind: "rememberThis", data: feed.dueReview });
  }
  if (feed.showBrainFact && feed.brainFact) {
    cards.push({ id: `brainfact-${feed.cycleId}`, kind: "brainFact", data: feed.brainFact });
  }
  for (const model of feed.mentalModelsOfTheWeek) {
    cards.push({ id: `mentalmodel-${model.id}`, kind: "mentalModel", data: model });
  }

  // --- Daily block: News only, favorite-weighted round robin. ---
  const dailyFavoriteQueues: QueueItem[][] = [];
  const dailyNormalQueues: QueueItem[][] = [];
  for (const section of feed.sections) {
    if (section.news.length === 0) continue;
    const queue: QueueItem[] = section.news.map((item) => ({
      card: { id: `news-${item.id}`, kind: "news", interestName: section.interestName, interestId: section.interestId, data: item },
      weight: 1,
    }));
    (section.isFavorite ? dailyFavoriteQueues : dailyNormalQueues).push(queue);
  }
  cards.push(...roundRobin(dailyFavoriteQueues, dailyNormalQueues).map((q) => q.card));

  // --- Weekly block: "This Week in [Interest]" headers, then that
  // content's favorite-weighted, short/long-interleaved cards. ---
  const weeklyFavoriteQueues: QueueItem[][] = [];
  const weeklyNormalQueues: QueueItem[][] = [];
  for (const section of feed.sections) {
    const weeklyCount = section.deepDives.length + section.appliedInsights.length;
    if (weeklyCount === 0) continue;
    cards.push({
      id: `weekly-header-${section.interestId}`,
      kind: "weeklyBundleHeader",
      interestName: section.interestName,
      count: weeklyCount,
    });

    const queue: QueueItem[] = [];
    for (const insight of section.appliedInsights) {
      queue.push({
        card: {
          id: `insight-${insight.id}`,
          kind: "appliedInsight",
          interestName: section.interestName,
          interestId: section.interestId,
          data: insight,
        },
        weight: 1,
      });
    }
    for (const dive of section.deepDives) {
      queue.push({
        card: {
          id: `dive-${dive.id}`,
          kind: "deepDiveHook",
          interestName: section.interestName,
          interestId: section.interestId,
          data: dive,
        },
        weight: 2,
      });
    }
    (section.isFavorite ? weeklyFavoriteQueues : weeklyNormalQueues).push(queue);
  }

  const weeklyItems = roundRobin(weeklyFavoriteQueues, weeklyNormalQueues);
  const shortCards = weeklyItems.filter((i) => i.weight === 1).map((i) => i.card);
  const longCards = weeklyItems.filter((i) => i.weight === 2).map((i) => i.card);
  const weeklyInterleaved: StreamCard[] = [];
  const SHORTS_PER_LONG = 3;
  let si = 0;
  let li = 0;
  while (si < shortCards.length || li < longCards.length) {
    for (let k = 0; k < SHORTS_PER_LONG && si < shortCards.length; k++) weeklyInterleaved.push(shortCards[si++]);
    if (li < longCards.length) weeklyInterleaved.push(longCards[li++]);
  }

  // Rabbit Hole(s) of the Week: clearly-placed slot(s) near the midpoint of
  // the weekly block's interleaved content (not randomly mixed in).
  if (feed.rabbitHolesOfTheWeek.length > 0) {
    const midpoint = Math.floor(weeklyInterleaved.length / 2);
    weeklyInterleaved.splice(
      midpoint,
      0,
      ...feed.rabbitHolesOfTheWeek.map((hole) => ({ id: `rabbithole-${hole.id}`, kind: "rabbitHole" as const, data: hole }))
    );
  }

  cards.push(...weeklyInterleaved);

  // Brain Games: individual cards (not a grouped section) — only on the live
  // feed, same "today's picks" reasoning as dueReview above. Weekly cadence
  // now (Phase 13), but still gated to the live feed only.
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
  for (const pointer of feed.bookChaptersOfTheWeek) {
    cards.push({ id: `chapter-pointer-${pointer.bookId}`, kind: "chapterPointer", data: pointer });
  }

  cards.push({
    id: "caught-up",
    kind: "caughtUp",
    conceptsThisMonth: feed.progress.conceptsThisMonth,
    interestsCount: feed.progress.interestsCount,
    message: isArchive
      ? "That's everything compiled into this historical cycle."
      : caughtUpMessage(seenFlags?.dailyFullySeen ?? false, seenFlags?.weeklyFullySeen ?? false),
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
  weeklyBundleHeader: "🗓️",
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
    case "weeklyBundleHeader":
      return {
        title: `This Week in ${card.interestName}`,
        snippet: `${card.count} item${card.count === 1 ? "" : "s"} this week`,
      };
    case "caughtUp":
      return { title: "You're caught up", snippet: card.message };
  }
}

import type { StreamCard } from "@/lib/stream";
import { ItemCard } from "../ItemCard";
import { AppliedInsightCard } from "../AppliedInsightCard";
import { MentalModelCard } from "../MentalModelCard";
import { RabbitHoleCard } from "../RabbitHoleCard";
import { RememberThisCard } from "../RememberThisCard";
import { BrainFactCard } from "../BrainFactCard";
import { BrainGameCard } from "../BrainGameCard";
import { DrillPointerCard } from "../DrillPointerCard";
import { BookChapterPointerCard } from "../BookChapterPointerCard";
import { CaughtUpCard } from "../CaughtUpCard";
import { StreamDeepDiveHookCard } from "./StreamDeepDiveHookCard";

/** Renders the single card matching a stream item's kind. Short/self-
 * contained kinds reuse their existing card component untouched; News and
 * Applied Insight get an interest-name pill above them since the stream has
 * no per-interest section heading to provide that context anymore. */
export function StreamCardView({ card, nextCardId }: { card: StreamCard; nextCardId?: string }) {
  switch (card.kind) {
    case "rememberThis":
      return <RememberThisCard due={card.data} />;
    case "brainFact":
      return <BrainFactCard fact={card.data} />;
    case "mentalModel":
      return <MentalModelCard entry={card.data} />;
    case "rabbitHole":
      return <RabbitHoleCard entry={card.data} />;
    case "news":
      return (
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <span className="pill">📰 News</span>
            <span className="pill">{card.interestName}</span>
          </div>
          <ItemCard item={card.data} />
        </div>
      );
    case "appliedInsight":
      return (
        <div>
          <span className="pill mb-2 inline-block">{card.interestName}</span>
          <AppliedInsightCard entry={card.data} />
        </div>
      );
    case "deepDiveHook":
      return <StreamDeepDiveHookCard entry={card.data} interestName={card.interestName} nextCardId={nextCardId} />;
    case "brainGame":
      return <BrainGameCard game={card.data} />;
    case "drillPointer":
      return <DrillPointerCard count={card.count} />;
    case "chapterPointer":
      return <BookChapterPointerCard entry={card.data} />;
    case "caughtUp":
      return (
        <CaughtUpCard
          conceptsThisMonth={card.conceptsThisMonth}
          interestsCount={card.interestsCount}
          frequency={card.frequency}
        />
      );
  }
}

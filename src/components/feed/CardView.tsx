"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { FeedCard, CardEventName } from "@/lib/cardTypes";
import { CARD_KIND_LABELS, SOURCE_BADGE_LABELS } from "@/lib/cardTypes";
import type { SourceBadge } from "@/lib/cardTypes";
import { LEVEL_LABELS } from "@/db/schema";
import { interestStyle, formatDate, postJson } from "@/lib/ui";
import { Icon } from "../Icon";
import { Mermaid } from "../Mermaid";
import { QuizBlock } from "./QuizBlock";

export interface CardHandlers {
  onEvent: (cardId: number, event: CardEventName, value?: number) => void;
  onOpenDeepDive: (deepDiveId: number, card: FeedCard) => void;
  onAsk: (card: FeedCard) => void;
  onReport: (card: FeedCard) => void;
  onRefresh: () => void; // re-ask the server for more (brewing / caught-up cards)
}

const BADGE_TONE: Record<SourceBadge, string> = {
  "peer-reviewed": "border-neuron-accent3/50 bg-neuron-accent3/10 text-neuron-accent3",
  preprint: "border-neuron-warn/50 bg-neuron-warn/10 text-neuron-warn",
  journalism: "border-neuron-border bg-neuron-surface2 text-neuron-muted",
  "ai-roundup": "border-neuron-border bg-neuron-surface2 text-neuron-muted",
};

/** Wraps the first occurrence of `term` in the text with an emphasis mark. */
function Highlighted({ text, term }: { text: string; term?: string }) {
  if (!term) return <>{text}</>;
  const at = text.indexOf(term);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <strong className="rounded-md bg-[var(--ic-soft)] px-1 font-extrabold text-neuron-text">{term}</strong>
      {text.slice(at + term.length)}
    </>
  );
}

function Header({ card }: { card: FeedCard }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {card.interestName && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ic-soft)] px-3 py-1 text-xs font-extrabold text-neuron-text">
          <span aria-hidden className="h-2 w-2 rounded-full bg-[var(--ic)]" />
          {card.interestName}
        </span>
      )}
      <span className="eyebrow">{card.kind === "quiz" && card.payload.drillLabel ? card.payload.drillLabel : CARD_KIND_LABELS[card.kind]}</span>
      {card.explore && <span className="pill">Outside your interests</span>}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  active = false,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active || undefined}
      className={`flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-2xl px-2 text-[11px] font-bold transition hover:bg-neuron-surface2 ${
        active ? "text-neuron-accent" : "text-neuron-muted hover:text-neuron-text"
      }`}
    >
      <Icon name={icon} filled={active} />
      {label}
    </button>
  );
}

/** Reads the card aloud with the browser's built-in speech synthesis. */
function useSpeech(text: string, active: boolean) {
  const [speaking, setSpeaking] = useState(false);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  useEffect(() => {
    // Stop when the card scrolls away or unmounts.
    if (!active && speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }
    return () => {
      if (speaking) window.speechSynthesis.cancel();
    };
  }, [active, speaking]);
  function toggle() {
    if (!supported) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    setSpeaking(true);
  }
  return { supported, speaking, toggle };
}

function Actions({ card, active, handlers, speechText }: { card: FeedCard; active: boolean; handlers: CardHandlers; speechText: string }) {
  const [saved, setSaved] = useState(card.saved);
  const [copied, setCopied] = useState(false);
  const speech = useSpeech(speechText, active);
  if (card.cardId === null) return null;
  const cardId = card.cardId;

  async function share() {
    const url = `${location.origin}/s/${cardId}`;
    handlers.onEvent(cardId, "shared");
    try {
      if (navigator.share) {
        await navigator.share({ title: card.title, text: card.payload.takeaway ?? card.title, url });
        return;
      }
    } catch {
      return; // share sheet dismissed
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }

  return (
    <div className="flex items-center justify-between gap-1 border-t border-neuron-border pt-2">
      <div className="flex items-center gap-1">
        <ActionButton
          icon="bookmark"
          label={saved ? "Saved" : "Save"}
          active={saved}
          onClick={() => {
            handlers.onEvent(cardId, saved ? "unsaved" : "saved");
            setSaved(!saved);
          }}
        />
        <ActionButton icon="share" label={copied ? "Copied" : "Share"} onClick={share} />
        <ActionButton icon="ask" label="Ask" onClick={() => handlers.onAsk(card)} />
        {speech.supported && <ActionButton icon={speech.speaking ? "stop" : "listen"} label={speech.speaking ? "Stop" : "Listen"} onClick={speech.toggle} active={speech.speaking} />}
        <ActionButton icon="more" label="Report" onClick={() => handlers.onReport(card)} />
      </div>
      {card.deepDiveId !== null && (
        <button
          type="button"
          className="btn-primary !min-h-[40px] !px-4 !py-2"
          onClick={() => {
            handlers.onEvent(cardId, "go_deeper");
            handlers.onOpenDeepDive(card.deepDiveId!, card);
          }}
        >
          Go deeper <Icon name="deeper" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function RecallReview({ card }: { card: FeedCard }) {
  const [revealed, setRevealed] = useState(false);
  const [graded, setGraded] = useState<string | null>(null);
  async function grade(g: "again" | "good" | "easy") {
    setGraded(g);
    try {
      navigator.vibrate?.(10);
    } catch {}
    await postJson("/api/review", { conceptId: card.conceptId, grade: g });
  }
  return (
    <div className="w-full">
      <p className="text-base text-neuron-muted">Without looking it up — what is</p>
      <h2 className="mt-1 font-display text-3xl font-bold leading-tight">{card.title}?</h2>
      {!revealed ? (
        <button type="button" className="btn-secondary mt-6" onClick={() => setRevealed(true)}>
          Show the answer
        </button>
      ) : (
        <div aria-live="polite">
          <p className="mt-5 rounded-2xl bg-neuron-surface2 p-4 text-lg leading-relaxed">{card.body}</p>
          {graded ? (
            <p className="mt-4 text-sm font-bold text-neuron-accent3">Noted — it will come back at the right time.</p>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => grade("again")}>
                Forgot it
              </button>
              <button type="button" className="btn-secondary" onClick={() => grade("good")}>
                Got it
              </button>
              <button type="button" className="btn-secondary" onClick={() => grade("easy")}>
                Easy
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PaperBody({ card, onExpand }: { card: FeedCard; onExpand: () => void }) {
  const [open, setOpen] = useState(false);
  const p = card.payload;
  const badge = (p.badge ?? "journalism") as SourceBadge;
  return (
    <div className="w-full">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-extrabold ${BADGE_TONE[badge]}`}>{SOURCE_BADGE_LABELS[badge]}</span>
        <span className="text-xs font-semibold text-neuron-muted">
          {p.sourceName}
          {p.publishedAt ? ` · ${formatDate(p.publishedAt)}` : ""}
        </span>
      </div>
      <h2 className="font-display text-2xl font-bold leading-tight sm:text-3xl">{card.title}</h2>
      {p.takeaway && <p className="mt-3 text-lg font-bold leading-snug text-neuron-text">{p.takeaway}</p>}
      {open ? (
        <p className="mt-3 text-base leading-relaxed text-neuron-text/90">{card.body}</p>
      ) : (
        <button
          type="button"
          className="mt-3 block min-h-[44px] text-left text-sm font-extrabold text-neuron-accent"
          onClick={() => {
            setOpen(true);
            onExpand();
          }}
        >
          Read the summary
        </button>
      )}
      {p.authors && open && <p className="mt-2 text-xs text-neuron-muted">{p.authors}</p>}
      {p.url && (
        <a href={p.url} target="_blank" rel="noopener noreferrer" className="mt-2 flex min-h-[44px] w-fit items-center gap-1.5 text-sm font-extrabold text-neuron-accent">
          Read the source <Icon name="external" className="h-4 w-4" />
        </a>
      )}
    </div>
  );
}

function Body({ card, handlers }: { card: FeedCard; handlers: CardHandlers }) {
  const p = card.payload;
  const emit = (event: CardEventName) => card.cardId !== null && handlers.onEvent(card.cardId, event);

  switch (card.kind) {
    case "bite":
      return (
        <div className="w-full">
          <h2 className="font-display text-3xl font-bold leading-tight sm:text-4xl">{card.title}</h2>
          <p className="mt-4 text-lg leading-relaxed text-neuron-text/95 sm:text-xl">
            <Highlighted text={card.body} term={p.highlight} />
          </p>
          {p.takeaway && (
            <p className="mt-5 border-l-4 border-[var(--ic)] pl-4 text-base font-bold leading-snug text-neuron-text">{p.takeaway}</p>
          )}
        </div>
      );
    case "paper":
      return <PaperBody card={card} onExpand={() => emit("expanded")} />;
    case "quiz":
      return (
        <QuizBlock
          question={card.body}
          options={p.options ?? []}
          correctIndex={p.correctIndex ?? 0}
          explanation={p.explanation ?? ""}
          onAnswer={(correct) => emit(correct ? "quiz_correct" : "quiz_incorrect")}
        />
      );
    case "review":
      return p.quiz ? (
        <div className="w-full">
          <p className="mb-3 text-sm font-bold text-neuron-muted">You met “{card.title}” a while ago. Still got it?</p>
          <QuizBlock
            question={p.quiz.question}
            options={p.quiz.options ?? []}
            correctIndex={p.quiz.correctIndex ?? 0}
            explanation={p.quiz.explanation ?? ""}
            onAnswer={(correct) => emit(correct ? "quiz_correct" : "quiz_incorrect")}
          />
        </div>
      ) : (
        <RecallReview card={card} />
      );
    case "debate":
      return (
        <div className="w-full">
          <h2 className="font-display text-2xl font-bold leading-tight">{card.title}</h2>
          <div className="mt-4 rounded-2xl border border-neuron-border bg-neuron-surface2 p-4">
            <p className="eyebrow mb-1">The claim</p>
            <p className="text-base leading-relaxed">{p.claim}</p>
          </div>
          <div className="mt-3 rounded-2xl border-2 border-[var(--ic)] bg-[var(--ic-soft)] p-4">
            <p className="eyebrow mb-1">The strongest case against it</p>
            <p className="text-base leading-relaxed">{card.body}</p>
          </div>
          {p.url && (
            <a href={p.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm font-extrabold text-neuron-accent">
              {p.sourceName ?? "Source"} <Icon name="external" className="h-4 w-4" />
            </a>
          )}
        </div>
      );
    case "insight":
      return (
        <div className="w-full">
          <p className="eyebrow">From “{card.title}”</p>
          <p className="mt-3 text-xl font-semibold leading-relaxed sm:text-2xl">{card.body}</p>
        </div>
      );
    case "visual":
      return (
        <div className="w-full">
          <h2 className="mb-4 font-display text-2xl font-bold leading-tight">{card.title}</h2>
          <Mermaid source={p.mermaid} caption={p.caption ?? card.body} />
        </div>
      );
    case "myth":
      return (
        <div className="w-full">
          <div className="rounded-2xl border border-neuron-danger/40 bg-neuron-danger/10 p-4">
            <p className="eyebrow mb-1 !text-neuron-danger">Myth</p>
            <p className="text-xl font-bold leading-snug">{p.myth ?? card.title}</p>
          </div>
          <div className="mt-3 rounded-2xl border border-neuron-accent3/40 bg-neuron-accent3/10 p-4">
            <p className="eyebrow mb-1 !text-neuron-accent3">What's actually true</p>
            <p className="text-lg leading-relaxed">{p.fact ?? card.body}</p>
          </div>
        </div>
      );
    case "model":
      return (
        <div className="w-full">
          <p className="eyebrow">A thinking tool · {p.category}</p>
          <h2 className="mt-2 font-display text-3xl font-bold leading-tight">{card.title}</h2>
          <p className="mt-4 text-lg leading-relaxed">{card.body}</p>
        </div>
      );
    case "fact":
      return (
        <div className="w-full">
          <p className="eyebrow">{card.title}</p>
          <p className="mt-3 font-display text-2xl font-semibold leading-snug sm:text-3xl">{card.body}</p>
        </div>
      );
    case "game":
      return <GameBody card={card} />;
    case "chapter":
      return (
        <div className="w-full">
          <p className="eyebrow">Next chapter is ready</p>
          <h2 className="mt-2 font-display text-2xl font-bold leading-tight sm:text-3xl">{card.title}</h2>
          <p className="mt-3 text-base leading-relaxed text-neuron-text/90">{card.body}</p>
          <Link href={`/library/chapter/${p.chapterId}`} className="btn-primary mt-5">
            Read the chapter notes
          </Link>
        </div>
      );
    case "recap":
      return (
        <div className="w-full text-center">
          <p aria-hidden className="text-5xl">✨</p>
          <h2 className="mt-3 font-display text-3xl font-bold">{card.title}</h2>
          <p className="mt-2 text-base text-neuron-muted">{card.body}</p>
          {Array.isArray(p.concepts) && p.concepts.length > 0 && (
            <ul className="mt-5 flex flex-wrap justify-center gap-2">
              {p.concepts.map((c: string) => (
                <li key={c} className="pill !text-neuron-text">
                  {c}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-6 text-sm text-neuron-muted">Keep going, or call it a session — both are fine.</p>
          <Link href="/map" className="btn-secondary mt-3">
            See your knowledge map
          </Link>
        </div>
      );
    case "brewing":
      return <Brewing card={card} onRefresh={handlers.onRefresh} />;
    case "caughtup":
      return (
        <div className="w-full text-center">
          <p aria-hidden className="text-5xl">🎉</p>
          <h2 className="mt-3 font-display text-3xl font-bold">{card.title}</h2>
          <p className="mt-2 text-base text-neuron-muted">{card.body}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link href="/review" className="btn-secondary">
              Review what you know
            </Link>
            <Link href="/explore" className="btn-secondary">
              Explore more fields
            </Link>
          </div>
        </div>
      );
  }
}

function GameBody({ card }: { card: FeedCard }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="w-full">
      <p className="eyebrow">Just for fun · {card.title}</p>
      <p className="mt-3 whitespace-pre-line text-xl font-semibold leading-relaxed">{card.body}</p>
      {shown ? (
        <p className="mt-4 rounded-2xl bg-neuron-surface2 p-4 text-lg font-bold" aria-live="polite">
          {card.payload.answer}
        </p>
      ) : (
        <button type="button" className="btn-secondary mt-5" onClick={() => setShown(true)}>
          Show answer
        </button>
      )}
      <p className="mt-4 text-xs text-neuron-muted">Puzzles like this are a fun break, not a proven way to get smarter in general.</p>
    </div>
  );
}

/** Shown while new entries are being written; nudges the queue and checks back. */
function Brewing({ card, onRefresh }: { card: FeedCard; onRefresh: () => void }) {
  useEffect(() => {
    // Push the queue along (reply intentionally not awaited), then look again.
    fetch("/api/jobs/kick", { method: "POST" }).catch(() => {});
    const t = setInterval(onRefresh, 20000);
    return () => clearInterval(t);
  }, [onRefresh]);
  return (
    <div className="w-full text-center">
      <div aria-hidden className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-neuron-border border-t-neuron-accent" />
      <h2 className="mt-5 font-display text-3xl font-bold">{card.title}</h2>
      <p className="mt-2 text-base text-neuron-muted" role="status">
        {card.body}
      </p>
      <button type="button" className="btn-secondary mt-6" onClick={onRefresh}>
        Check now
      </button>
    </div>
  );
}

/** One full-screen feed card. */
export function CardView({ card, active, handlers }: { card: FeedCard; active: boolean; handlers: CardHandlers }) {
  const speechText = [card.title, card.payload.takeaway, card.body].filter(Boolean).join(". ");
  const centered = ["recap", "brewing", "caughtup"].includes(card.kind);
  return (
    <article
      aria-label={`${CARD_KIND_LABELS[card.kind]}: ${card.title}`}
      style={interestStyle(card.interestId)}
      className="mx-auto flex h-full w-full max-w-2xl flex-col px-4 pb-3 pt-4 sm:px-6"
    >
      <div className="flex min-h-0 flex-1 flex-col rounded-3xl border border-neuron-border bg-neuron-surface p-5 shadow-sm sm:p-7">
        {!centered && <Header card={card} />}
        <div className={`flex min-h-0 flex-1 flex-col overflow-y-auto py-4 ${centered ? "justify-center" : "justify-center"}`}>
          <Body card={card} handlers={handlers} />
        </div>
        {card.level && card.kind === "bite" && (
          <p className="mb-2 text-xs text-neuron-muted">
            {LEVEL_LABELS[card.level]}
            {card.conceptName ? ` · teaches “${card.conceptName}”` : ""}
            {card.aiGenerated ? " · AI-written from cited sources" : ""}
          </p>
        )}
        <Actions card={card} active={active} handlers={handlers} speechText={speechText} />
      </div>
    </article>
  );
}

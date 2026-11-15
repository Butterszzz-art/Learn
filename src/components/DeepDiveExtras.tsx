"use client";

import { useState } from "react";
import { QuizBlock } from "./feed/QuizBlock";
import { AskSheet, ReportSheet } from "./feed/Sheets";
import { Icon } from "./Icon";

interface Quiz { cardId: number | null; question: string; options: string[]; correctIndex: number; explanation: string }

function send(cardId: number | null, correct: boolean) {
  if (!cardId) return;
  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events: [{ cardId, event: correct ? "quiz_correct" : "quiz_incorrect" }] }),
    keepalive: true,
  }).catch(() => {});
}

/** Self-check questions on a deep dive page. Answers are saved and feed the review schedule. */
export function DeepDiveQuiz({ questions }: { questions: Quiz[] }) {
  if (questions.length === 0) return null;
  return (
    <section className="mt-10 border-t border-neuron-border pt-6" aria-labelledby="quiz-heading">
      <h2 id="quiz-heading" className="eyebrow mb-4">Check yourself</h2>
      <div className="space-y-8">
        {questions.map((q, i) => (
          <QuizBlock key={i} compact question={q.question} options={q.options} correctIndex={q.correctIndex} explanation={q.explanation} onAnswer={(c) => send(q.cardId, c)} />
        ))}
      </div>
    </section>
  );
}

/** Listen / Ask / Report controls for a deep dive page. */
export function DeepDiveTools({ deepDiveId, speechText }: { deepDiveId: number; speechText: string }) {
  const [sheet, setSheet] = useState<"ask" | "report" | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

  function toggleSpeech() {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    // Long text is spoken paragraph by paragraph; some browsers cut off a single long utterance.
    const parts = speechText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      if (i === parts.length - 1) u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    });
    setSpeaking(true);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canSpeak && (
        <button type="button" className="btn-secondary !min-h-[40px] !py-2" onClick={toggleSpeech}>
          <Icon name={speaking ? "stop" : "listen"} className="h-4 w-4" /> {speaking ? "Stop" : "Listen"}
        </button>
      )}
      <button type="button" className="btn-secondary !min-h-[40px] !py-2" onClick={() => setSheet("ask")}>
        <Icon name="ask" className="h-4 w-4" /> Ask a question
      </button>
      <button type="button" className="btn-ghost !min-h-[40px] !py-2" onClick={() => setSheet("report")}>Report a problem</button>
      {sheet === "ask" && <AskSheet deepDiveId={deepDiveId} onClose={() => setSheet(null)} />}
      {sheet === "report" && <ReportSheet deepDiveId={deepDiveId} onClose={() => setSheet(null)} />}
    </div>
  );
}

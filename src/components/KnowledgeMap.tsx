"use client";

import { useState } from "react";
import Link from "next/link";
import type { InterestKnowledge, MapConcept } from "@/lib/learning";
import type { Mastery } from "@/lib/cardTypes";
import { MASTERY_LABELS } from "@/lib/cardTypes";
import { interestStyle, formatDate } from "@/lib/ui";
import { Sheet } from "./feed/Sheets";

const TIERS = ["Foundations", "Core ideas", "Going deeper", "Advanced", "Research frontier"];

// Mastery is shown by fill strength AND a text label, never colour alone.
const NODE_TONE: Record<Mastery, string> = {
  unseen: "border-dashed border-neuron-border bg-transparent text-neuron-muted",
  seen: "border-[var(--ic)] bg-[var(--ic-soft)] text-neuron-text",
  learning: "border-[var(--ic)] bg-[var(--ic-soft)] text-neuron-text ring-2 ring-[var(--ic-soft)]",
  recalled: "border-[var(--ic)] bg-[var(--ic)] text-white",
  mastered: "border-[var(--ic)] bg-[var(--ic)] text-white shadow-md",
};
const MARK: Record<Mastery, string> = { unseen: "○", seen: "◔", learning: "◑", recalled: "◕", mastered: "●" };

export function KnowledgeMap({ fields }: { fields: InterestKnowledge[] }) {
  const [active, setActive] = useState(fields[0]?.interestId ?? null);
  const [open, setOpen] = useState<MapConcept | null>(null);
  const field = fields.find((f) => f.interestId === active) ?? fields[0];
  if (!field) return <p className="text-neuron-muted">Your map fills in as you read. Start with a few cards in your feed.</p>;
  const byId = new Map(field.concepts.map((c) => [c.id, c]));

  return (
    <div style={interestStyle(field.interestId)}>
      {fields.length > 1 && (
        <div className="mb-5 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Field">
          {fields.map((f) => (
            <button key={f.interestId} type="button" role="tab" aria-selected={f.interestId === field.interestId} onClick={() => setActive(f.interestId)} className={`pill shrink-0 !py-1.5 ${f.interestId === field.interestId ? "!border-neuron-accent !bg-neuron-accent/15 !text-neuron-text" : ""}`}>
              {f.interestName.replace(/^Library: /, "📚 ")}
            </button>
          ))}
        </div>
      )}

      <ul className="mb-5 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-neuron-muted" aria-label="Legend">
        {(Object.keys(MASTERY_LABELS) as Mastery[]).map((m) => (
          <li key={m}><span aria-hidden>{MARK[m]}</span> {MASTERY_LABELS[m]} ({field.counts[m]})</li>
        ))}
      </ul>

      <div className="space-y-6">
        {TIERS.map((tier, idx) => {
          const concepts = field.concepts.filter((c) => Math.min(5, Math.max(1, c.difficulty)) === idx + 1);
          if (concepts.length === 0) return null;
          return (
            <section key={tier} aria-label={tier}>
              <h3 className="eyebrow mb-2">{tier}</h3>
              <ul className="flex flex-wrap gap-2">
                {concepts.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => setOpen(c)} className={`min-h-[40px] rounded-full border-2 px-3.5 py-1.5 text-sm font-bold transition hover:scale-[1.03] ${NODE_TONE[c.mastery]}`}>
                      <span aria-hidden className="mr-1">{MARK[c.mastery]}</span>
                      {c.name}
                      <span className="sr-only"> — {MASTERY_LABELS[c.mastery]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {open && (
        <Sheet title={open.name} onClose={() => setOpen(null)}>
          <p className="pill !text-neuron-text">{MARK[open.mastery]} {MASTERY_LABELS[open.mastery]}</p>
          <p className="mt-3 text-lg leading-relaxed">{open.definition}</p>
          {open.prereqs.length > 0 && (
            <div className="mt-4">
              <p className="eyebrow mb-2">Builds on</p>
              <ul className="flex flex-wrap gap-2">
                {open.prereqs.map((id) => {
                  const p = byId.get(id);
                  return p ? (
                    <li key={id}>
                      <button type="button" className="pill !text-neuron-text" onClick={() => setOpen(p)}>{MARK[p.mastery]} {p.name}</button>
                    </li>
                  ) : null;
                })}
              </ul>
            </div>
          )}
          {open.due && open.mastery !== "unseen" && <p className="mt-4 text-sm text-neuron-muted">Next review: {formatDate(open.due)}</p>}
          {open.deepDiveId && <Link href={`/deep-dive/${open.deepDiveId}`} className="btn-primary mt-5">{open.mastery === "unseen" ? "Learn this" : "Read it again"}</Link>}
          {open.chapterId && <Link href={`/library/chapter/${open.chapterId}`} className="btn-primary mt-5">Open the chapter</Link>}
        </Sheet>
      )}
    </div>
  );
}

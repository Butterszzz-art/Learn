export function BrainFactCard({ fact }: { fact: { text: string; topic: string | null } | null }) {
  if (!fact) return null;
  return (
    <div className="card border-brain-accent2/40 bg-gradient-to-br from-brain-surface to-brain-surface2">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-lg">✨</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-brain-accent2">
          Brain Fact of the Day
        </span>
        {fact.topic && <span className="pill">{fact.topic}</span>}
      </div>
      <p className="font-serif text-lg leading-relaxed text-brain-text">{fact.text}</p>
    </div>
  );
}

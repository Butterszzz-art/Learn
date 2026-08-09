export function BrainFactCard({ fact }: { fact: { text: string; topic: string | null } | null }) {
  if (!fact) return null;
  return (
    <div className="card border-neuron-accent2/40 bg-gradient-to-br from-neuron-surface to-neuron-surface2">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-lg">✨</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-neuron-accent2">
          Brain Fact of the Day
        </span>
        {fact.topic && <span className="pill">{fact.topic}</span>}
      </div>
      <p className="font-display text-lg leading-relaxed text-neuron-text">{fact.text}</p>
    </div>
  );
}

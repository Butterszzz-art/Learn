import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getWeeklyRecap, recapShareText } from "@/lib/weekly";
import { ShareTextButton } from "@/components/ShareTextButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your week" };

function Big({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="card !p-4 text-center">
      <p className="font-display text-4xl font-bold">{value}</p>
      <p className="mt-0.5 text-xs font-bold text-neuron-muted">{label}</p>
    </div>
  );
}

/** The last seven days, as a recap worth looking at (and sharing). */
export default async function WeekPage() {
  const user = await requireUser();
  const r = await getWeeklyRecap(user.id);
  const accuracy = r.quizAnswered > 0 ? Math.round((r.quizCorrect / r.quizAnswered) * 100) : null;

  if (r.cards === 0) {
    return (
      <div>
        <h1 className="page-title">Your week</h1>
        <p className="mt-4 text-neuron-muted">Nothing read in the last seven days yet. Today&apos;s set is a good place to start.</p>
        <Link href="/" className="btn-primary mt-4">Open the feed</Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">Your week</h1>
      <p className="mt-1 text-sm text-neuron-muted">The last seven days.</p>

      <section className="mt-6 rounded-3xl bg-gradient-to-br from-neuron-accent to-neuron-accent2 p-6 text-neuron-onaccent">
        <p className="text-sm font-extrabold uppercase tracking-wider opacity-90">New ideas met</p>
        <p className="mt-1 font-display text-6xl font-bold">{r.newIdeaCount}</p>
        {r.newIdeas.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {r.newIdeas.map((n) => (
              <li key={n} className="rounded-full bg-white/20 px-3 py-1 text-sm font-bold">
                {n}
              </li>
            ))}
            {r.newIdeaCount > r.newIdeas.length && <li className="px-1 py-1 text-sm font-bold opacity-90">+{r.newIdeaCount - r.newIdeas.length} more</li>}
          </ul>
        )}
      </section>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Big value={r.cards} label="cards read" />
        <Big value={`${r.readingMinutes} min`} label="spent reading" />
        <Big value={accuracy === null ? "–" : `${accuracy}%`} label={`on ${r.quizAnswered} quick check${r.quizAnswered === 1 ? "" : "s"}`} />
        <Big value={`${r.activeDays}/7`} label="days you showed up" />
      </div>

      {(r.topField || r.rabbitHole || r.guesses > 0) && (
        <ul className="mt-4 space-y-2">
          {r.topField && (
            <li className="card !p-4">
              <p className="eyebrow">Most-read field</p>
              <p className="mt-1 font-bold">
                {r.topField.name} <span className="font-normal text-neuron-muted">· {r.topField.cards} cards</span>
              </p>
            </li>
          )}
          {r.rabbitHole && (
            <li className="card !p-4">
              <p className="eyebrow">Deepest rabbit hole</p>
              <Link href={`/deep-dive/${r.rabbitHole.id}`} className="mt-1 block font-bold text-neuron-accent">
                {r.rabbitHole.topic}
              </Link>
              <p className="text-sm text-neuron-muted">{r.rabbitHole.minutes} minutes in</p>
            </li>
          )}
          {r.guesses > 0 && (
            <li className="card !p-4">
              <p className="eyebrow">Guesses and sides taken</p>
              <p className="mt-1 font-bold">{r.guesses}</p>
            </li>
          )}
        </ul>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <ShareTextButton title="My week on Neuron" text={recapShareText(r)} />
        <Link href="/map" className="btn-secondary">
          See your knowledge map
        </Link>
      </div>
    </div>
  );
}

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getEnabledInterests } from "@/lib/interests";
import { getKnowledgeMap, getKnowledgeSummary, countDue } from "@/lib/learning";
import { getStreak } from "@/lib/explore";
import { PLAN_LIMITS } from "@/lib/plan";
import { interestStyle } from "@/lib/ui";
import { SignOutButton } from "@/components/SignOutButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Me" };

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="card !p-4 text-center">
      <p className="font-display text-3xl font-bold">{value}</p>
      <p className="mt-0.5 text-xs font-bold text-neuron-muted">{label}</p>
    </div>
  );
}

export default async function MePage() {
  const user = await requireUser();
  const interests = await getEnabledInterests(user.id);
  const [summary, map, due, streak] = await Promise.all([
    getKnowledgeSummary(user.id),
    getKnowledgeMap(user.id, interests.map((i) => i.id)),
    countDue(user.id),
    user.prefs.streakOptIn ? getStreak(user.id) : Promise.resolve(0),
  ]);
  const goal = user.prefs.dailyGoal ?? 0;

  return (
    <div>
      <h1 className="page-title">{user.displayName || "Your progress"}</h1>
      <p className="mt-1 text-sm text-neuron-muted">{user.email} · {PLAN_LIMITS[user.plan].label} plan</p>

      <section className="mt-6 rounded-3xl bg-gradient-to-br from-neuron-accent to-neuron-accent2 p-6 text-neuron-onaccent" aria-labelledby="score-heading">
        <h2 id="score-heading" className="text-sm font-extrabold uppercase tracking-wider opacity-90">Knowledge score</h2>
        <p className="mt-1 font-display text-6xl font-bold">{summary.score}</p>
        <p className="mt-2 text-sm font-semibold opacity-95">
          {summary.conceptsMet === 0
            ? "Read a few cards and answer a quick check — your score starts there."
            : `${summary.conceptsMet} ideas met, ${summary.conceptsSolid} of them solidly remembered. Points grow as ideas survive review, not just from reading.`}
        </p>
        <Link href="/map" className="mt-4 inline-flex min-h-[44px] items-center rounded-full bg-white/20 px-5 text-sm font-extrabold backdrop-blur hover:bg-white/30">See your knowledge map →</Link>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={summary.learnedThisWeek} label="new ideas this week" />
        <Stat value={summary.cardsThisWeek} label="cards this week" />
        <Stat value={summary.quizAccuracy === null ? "–" : `${Math.round(summary.quizAccuracy * 100)}%`} label="quiz accuracy (30 days)" />
        <Stat value={due} label="due for review" />
      </div>

      {(goal > 0 || user.prefs.streakOptIn) && (
        <div className="card mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          {goal > 0 && (
            <p className="text-sm font-semibold">
              Today: {summary.cardsToday} of {goal} cards{summary.cardsToday >= goal ? " — goal met" : ""}
            </p>
          )}
          {user.prefs.streakOptIn && <p className="text-sm font-semibold">{streak} day{streak === 1 ? "" : "s"} in a row <span className="font-normal text-neuron-muted">(one missed day a week is forgiven)</span></p>}
        </div>
      )}

      {map.length > 0 && (
        <section className="mt-8" aria-labelledby="fields-heading">
          <h2 id="fields-heading" className="eyebrow mb-3">By field</h2>
          <ul className="space-y-2">
            {map.map((k) => {
              const total = k.concepts.length;
              const seg = (n: number) => `${total ? (n / total) * 100 : 0}%`;
              return (
                <li key={k.interestId} className="card !p-4" style={interestStyle(k.interestId)}>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-bold">{k.interestName}</p>
                    <p className="text-xs font-bold text-neuron-muted">{k.counts.recalled + k.counts.mastered} solid · {total - k.counts.unseen} met · {total} mapped</p>
                  </div>
                  <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-neuron-surface2" aria-hidden>
                    <div className="bg-[var(--ic)]" style={{ width: seg(k.counts.mastered) }} />
                    <div className="bg-[var(--ic)] opacity-70" style={{ width: seg(k.counts.recalled) }} />
                    <div className="bg-[var(--ic)] opacity-45" style={{ width: seg(k.counts.learning) }} />
                    <div className="bg-[var(--ic)] opacity-25" style={{ width: seg(k.counts.seen) }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <nav className="mt-8 grid gap-2 sm:grid-cols-2" aria-label="Account">
        <Link href="/saved" className="card !p-4 font-bold hover:border-neuron-accent">Saved cards</Link>
        <Link href="/settings" className="card !p-4 font-bold hover:border-neuron-accent">Settings and interests</Link>
        <Link href="/upgrade" className="card !p-4 font-bold hover:border-neuron-accent">{user.plan === "pro" ? "Your Pro plan" : "Neuron Pro"}</Link>
        {user.role === "admin" && <Link href="/admin" className="card !p-4 font-bold hover:border-neuron-accent">Admin</Link>}
      </nav>
      <div className="mt-6"><SignOutButton /></div>
    </div>
  );
}

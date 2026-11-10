"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/ui";

interface Topic { topic: string; teaser: string }

/**
 * "Keep going": follow-up topics raised by this entry. If someone has
 * already had that topic written at this level it opens straight away;
 * otherwise it is queued and this waits for it (usually a minute or two).
 */
export function FollowUpCards({ interestId, topics, allowPick }: { interestId: number; topics: Topic[]; allowPick?: boolean }) {
  const router = useRouter();
  const [list, setList] = useState(topics);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  async function open(topic: string) {
    setWaiting(topic);
    setError(null);
    const res = await postJson<{ deepDiveId?: number; jobId?: number }>("/api/deep-dive/request", { interestId, topic });
    if (!res.ok || !res.data) {
      setError(res.error);
      setWaiting(null);
      return;
    }
    if (res.data.deepDiveId) {
      router.push(`/deep-dive/${res.data.deepDiveId}`);
      return;
    }
    const jobId = res.data.jobId;
    fetch("/api/jobs/kick", { method: "POST" }).catch(() => {});
    let ticks = 0;
    timer.current = setInterval(async () => {
      ticks++;
      const r = await fetch(`/api/jobs/${jobId}`).then((x) => x.json()).catch(() => null);
      if (r?.status === "done" && r.deepDiveId && !r.flagged) {
        clearInterval(timer.current!);
        router.push(`/deep-dive/${r.deepDiveId}`);
      } else if (r?.status === "failed" || (r?.status === "done" && (r.flagged || !r.deepDiveId)) || ticks > 90) {
        clearInterval(timer.current!);
        setError(r?.flagged ? "That entry didn't pass our source check, so it wasn't published. Try a different topic." : "That one couldn't be written just now. Try again in a bit.");
        setWaiting(null);
      } else if (ticks % 10 === 0) {
        fetch("/api/jobs/kick", { method: "POST" }).catch(() => {});
      }
    }, 4000);
  }

  async function moreOptions() {
    setLoadingMore(true);
    setError(null);
    const res = await postJson<{ candidates: Topic[] }>("/api/deep-dive/candidates", { interestId });
    if (res.ok && res.data) setList((prev) => [...prev, ...res.data!.candidates.filter((c) => !prev.some((p) => p.topic === c.topic))]);
    else setError(res.error);
    setLoadingMore(false);
  }

  if (list.length === 0 && !allowPick) return null;
  return (
    <section className="mt-10 border-t border-neuron-border pt-6" aria-labelledby="next-heading">
      <h2 id="next-heading" className="eyebrow mb-3">Keep going</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {list.map((t) => (
          <li key={t.topic}>
            <button type="button" onClick={() => open(t.topic)} disabled={waiting !== null} className="card h-full w-full text-left transition hover:border-neuron-accent disabled:opacity-60">
              <span className="block font-bold leading-snug">{t.topic}</span>
              <span className="mt-1 block text-sm text-neuron-muted">{waiting === t.topic ? "Researching and writing this — about a minute…" : t.teaser}</span>
            </button>
          </li>
        ))}
      </ul>
      {allowPick && (
        <button type="button" className="btn-ghost mt-3" onClick={moreOptions} disabled={loadingMore || waiting !== null}>
          {loadingMore ? "Finding options…" : "Suggest other next topics"}
        </button>
      )}
      <div aria-live="polite">{error && <p className="error-text mt-3">{error}</p>}</div>
    </section>
  );
}

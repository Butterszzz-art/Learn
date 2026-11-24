"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

export interface MonthlyBannerEntry {
  id: number;
  topic: string;
  interestName: string;
  periodLabel: string; // "October 2026"
  period: string; // "2026-10"
}

const KEY = "neuron:monthly-dismissed";

/**
 * One line above the feed when this month's Monthly Deep Dive is out: the
 * first entry's headline, and a link to the rest on the week page.
 * Dismissing hides it until the next month's issue.
 */
export function MonthlyBanner({ entries }: { entries: MonthlyBannerEntry[] }) {
  const period = entries[0]?.period;
  // Hidden until mounted, so a dismissed banner never flashes in.
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    let dismissed: string | null = null;
    try {
      dismissed = localStorage.getItem(KEY);
    } catch {}
    setHidden(dismissed === period);
  }, [period]);

  if (!period || hidden) return null;
  const first = entries[0];
  const more = entries.length - 1;

  function dismiss() {
    setHidden(true);
    try {
      localStorage.setItem(KEY, period!);
    } catch {}
  }

  return (
    <div className="px-4 pt-3 sm:px-6">
      <div className="flex items-center gap-3 rounded-2xl border border-neuron-accent/40 bg-neuron-accent/10 p-3 text-sm" role="status">
        <Icon name="issue" className="h-6 w-6 shrink-0 text-neuron-accent" />
        <Link href={`/deep-dive/${first.id}`} className="min-w-0 flex-1">
          <span className="block text-xs font-extrabold uppercase tracking-wider text-neuron-accent">
            Monthly Deep Dive · {first.periodLabel}
          </span>
          <span className="line-clamp-2 font-bold leading-snug">
            {first.interestName}: {first.topic}
          </span>
        </Link>
        {more > 0 && (
          <Link href="/week#monthly" className="hidden shrink-0 text-xs font-bold text-neuron-accent sm:block">
            +{more} more
          </Link>
        )}
        <button type="button" onClick={dismiss} aria-label="Hide this month's deep dive banner" className="shrink-0 rounded-full p-1 text-neuron-muted hover:text-neuron-text">
          <Icon name="close" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// Retention and session numbers for the admin page. The arithmetic is pure
// (see tests/metrics.test.ts); the queries live in lib/admin.ts.
import { expectedReadMs } from "./rank";

const DAY = 86400000;

function dayIndex(isoOrSqlite: string): number {
  return Math.floor(Date.parse(isoOrSqlite.slice(0, 10) + "T00:00:00Z") / DAY);
}

export interface RetentionWindow {
  label: string;
  hint: string;
  rate: number | null; // null when no one is old enough to measure
  eligible: number;
}

// Each window is [first day, last day] counted from the sign-up day (day 0).
export const RETENTION_WINDOWS: { label: string; hint: string; from: number; to: number }[] = [
  { label: "Came back next day", hint: "Active on day 1", from: 1, to: 1 },
  { label: "Active in week 2", hint: "Any day 7–13", from: 7, to: 13 },
  { label: "Active in month 2", hint: "Any day 30–59", from: 30, to: 59 },
];

/**
 * Share of people active in each window after signing up. Only people whose
 * window has fully passed are counted, so recent sign-ups don't drag it down.
 */
export function computeRetention(
  users: { id: number; createdAt: string }[],
  activeDays: Map<number, Set<number>>, // userId -> day indexes with activity
  today: number // day index
): RetentionWindow[] {
  return RETENTION_WINDOWS.map((w) => {
    let eligible = 0;
    let kept = 0;
    for (const u of users) {
      const start = dayIndex(u.createdAt);
      if (start + w.to >= today) continue; // window not over yet
      eligible++;
      const days = activeDays.get(u.id);
      if (!days) continue;
      for (let d = start + w.from; d <= start + w.to; d++) {
        if (days.has(d)) {
          kept++;
          break;
        }
      }
    }
    return { label: w.label, hint: w.hint, rate: eligible > 0 ? kept / eligible : null, eligible };
  });
}

export function toDayIndex(s: string): number {
  return dayIndex(s);
}

export interface SeenRow {
  userId: number;
  seenAt: string;
  dwellMs: number;
}

export const SESSION_GAP_MS = 30 * 60000;

/** Splits each person's card views into sessions (a 30-minute gap starts a new one). */
export function computeSessions(rows: SeenRow[]): { cards: number; readingMs: number }[] {
  const byUser = new Map<number, SeenRow[]>();
  for (const r of rows) {
    if (!byUser.has(r.userId)) byUser.set(r.userId, []);
    byUser.get(r.userId)!.push(r);
  }
  const sessions: { cards: number; readingMs: number }[] = [];
  for (const list of byUser.values()) {
    list.sort((a, b) => Date.parse(a.seenAt) - Date.parse(b.seenAt));
    let cur: { cards: number; readingMs: number } | null = null;
    let last = -Infinity;
    for (const r of list) {
      const t = Date.parse(r.seenAt);
      if (!cur || t - last > SESSION_GAP_MS) {
        cur = { cards: 0, readingMs: 0 };
        sessions.push(cur);
      }
      cur.cards++;
      // Cap any one card at 10 minutes so a phone left on doesn't count as reading.
      cur.readingMs += Math.min(r.dwellMs, 10 * 60000);
      last = t;
    }
  }
  return sessions;
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface CardTypeRow {
  cardType: string;
  dwellMs: number;
  bodyChars: number;
  completed: boolean;
  skippedFast: boolean;
  revisits: number;
  saved: boolean;
}

export interface CardTypeStat {
  cardType: string;
  shown: number;
  completedRate: number;
  fastSkipRate: number;
  revisitRate: number;
  saveRate: number;
  medianReadRatio: number | null; // time on card ÷ time it takes to read
}

/** How each kind of card is landing: the numbers to watch when changing formats. */
export function computeCardTypeStats(rows: CardTypeRow[]): CardTypeStat[] {
  const groups = new Map<string, CardTypeRow[]>();
  for (const r of rows) {
    if (!groups.has(r.cardType)) groups.set(r.cardType, []);
    groups.get(r.cardType)!.push(r);
  }
  const out: CardTypeStat[] = [];
  for (const [cardType, list] of groups) {
    const n = list.length;
    const ratios = list.filter((r) => r.dwellMs > 0).map((r) => r.dwellMs / expectedReadMs(r.bodyChars));
    out.push({
      cardType,
      shown: n,
      completedRate: list.filter((r) => r.completed).length / n,
      fastSkipRate: list.filter((r) => r.skippedFast).length / n,
      revisitRate: list.filter((r) => r.revisits > 0).length / n,
      saveRate: list.filter((r) => r.saved).length / n,
      medianReadRatio: median(ratios),
    });
  }
  return out.sort((a, b) => b.shown - a.shown);
}

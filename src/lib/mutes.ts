// Engagement-based pruning, per person. If someone keeps scrolling past one
// kind of card in one field — say, research summaries in Economics — the
// feed stops showing that kind there, tells them so, and offers to resume.
//
// This is the multi-user form of the earlier "switch a content type to
// on-demand" rule: content is shared now, so nothing stops being generated;
// it just stops being put in front of the person who isn't reading it.
import { client } from "@/db";
import type { CardType } from "@/db/schema";

export const MUTABLE_TYPES = ["paper", "bite", "insight", "quiz", "debate"] as const;
export type MutableType = (typeof MUTABLE_TYPES)[number];

export const MUTABLE_TYPE_LABELS: Record<MutableType, string> = {
  paper: "research summaries",
  bite: "deep-dive cards",
  insight: "try-this takeaways",
  quiz: "quick checks",
  debate: "counterarguments",
};

// News goes stale quickly, so it is judged over a shorter window.
const LOOKBACK_DAYS: Record<MutableType, number> = { paper: 14, bite: 42, insight: 42, quiz: 42, debate: 42 };
export const MIN_SHOWN_FOR_SIGNAL = 8;
export const ENGAGEMENT_THRESHOLD = 0.2;

export interface EngagementStats {
  shown: number;
  engaged: number;
  rate: number | null; // null = not enough data yet to judge
}

/** Pure: the engagement rate for a set of shown cards. */
export function engagementRate(shown: number, engaged: number): EngagementStats {
  if (shown < MIN_SHOWN_FOR_SIGNAL) return { shown, engaged, rate: null };
  return { shown, engaged, rate: engaged / shown };
}

export function shouldMute(stats: EngagementStats): boolean {
  return stats.rate !== null && stats.rate < ENGAGEMENT_THRESHOLD;
}

export interface MuteKey {
  interestId: number;
  cardType: MutableType;
}

export async function getMutes(userId: number): Promise<MuteKey[]> {
  const res = await client.execute({ sql: "SELECT interest_id, card_type FROM user_feed_mutes WHERE user_id = ?", args: [userId] });
  return (res.rows as any[]).map((r) => ({ interestId: Number(r.interest_id), cardType: r.card_type as MutableType }));
}

export function isMuted(mutes: MuteKey[], interestId: number | null, cardType: CardType): boolean {
  return interestId !== null && mutes.some((m) => m.interestId === interestId && m.cardType === cardType);
}

export interface MuteNotice {
  interestId: number;
  interestName: string;
  cardType: MutableType;
  label: string;
  mutedAt: string;
}

/** Mutes the person hasn't acknowledged yet. */
export async function getActiveMuteNotices(userId: number): Promise<MuteNotice[]> {
  const res = await client.execute({
    sql: `SELECT m.interest_id, m.card_type, m.muted_at, i.name FROM user_feed_mutes m
          JOIN interests i ON i.id = m.interest_id
          WHERE m.user_id = ? AND m.notice_dismissed_at IS NULL ORDER BY m.muted_at DESC`,
    args: [userId],
  });
  return (res.rows as any[]).map((r) => ({
    interestId: Number(r.interest_id),
    interestName: r.name,
    cardType: r.card_type as MutableType,
    label: MUTABLE_TYPE_LABELS[r.card_type as MutableType] ?? r.card_type,
    mutedAt: r.muted_at,
  }));
}

/** Everything currently muted, for Settings. */
export async function getAllMutes(userId: number): Promise<MuteNotice[]> {
  const res = await client.execute({
    sql: `SELECT m.interest_id, m.card_type, m.muted_at, i.name FROM user_feed_mutes m
          JOIN interests i ON i.id = m.interest_id WHERE m.user_id = ? ORDER BY i.name, m.card_type`,
    args: [userId],
  });
  return (res.rows as any[]).map((r) => ({
    interestId: Number(r.interest_id),
    interestName: r.name,
    cardType: r.card_type as MutableType,
    label: MUTABLE_TYPE_LABELS[r.card_type as MutableType] ?? r.card_type,
    mutedAt: r.muted_at,
  }));
}

export async function resumeMuted(userId: number, interestId: number, cardType: string): Promise<void> {
  await client.execute({
    sql: "DELETE FROM user_feed_mutes WHERE user_id = ? AND interest_id = ? AND card_type = ?",
    args: [userId, interestId, cardType],
  });
  // Resuming resets the evidence: rows that counted against it stop counting.
  await client.execute({
    sql: "UPDATE user_cards SET skipped_fast = 0 WHERE user_id = ? AND interest_id = ? AND card_type = ? AND completed = 0",
    args: [userId, interestId, cardType],
  });
  await client.execute({
    sql: `INSERT INTO user_feed_mutes_resumed (user_id, interest_id, card_type, resumed_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, interest_id, card_type) DO UPDATE SET resumed_at = excluded.resumed_at`,
    args: [userId, interestId, cardType, new Date().toISOString()],
  });
}

export async function dismissMuteNotice(userId: number, interestId: number, cardType: string): Promise<void> {
  await client.execute({
    sql: "UPDATE user_feed_mutes SET notice_dismissed_at = ? WHERE user_id = ? AND interest_id = ? AND card_type = ?",
    args: [new Date().toISOString(), userId, interestId, cardType],
  });
}

/**
 * Looks at what this person was shown recently and mutes any (interest,
 * card type) they consistently ignore. Only cards shown since the last
 * resume count, so resuming gives a type a fresh start.
 */
export async function runMuteSweep(userId: number): Promise<MuteKey[]> {
  const existing = await getMutes(userId);
  const flipped: MuteKey[] = [];
  for (const cardType of MUTABLE_TYPES) {
    const since = new Date(Date.now() - LOOKBACK_DAYS[cardType] * 86400000).toISOString();
    const res = await client.execute({
      sql: `SELECT uc.interest_id,
                   COUNT(*) AS shown,
                   SUM(CASE WHEN uc.completed = 1 OR uc.expanded = 1 OR uc.saved = 1 OR uc.answered_correct IS NOT NULL THEN 1 ELSE 0 END) AS engaged
            FROM user_cards uc
            JOIN user_interest_prefs p ON p.user_id = uc.user_id AND p.interest_id = uc.interest_id AND p.enabled = 1
            LEFT JOIN user_feed_mutes_resumed r ON r.user_id = uc.user_id AND r.interest_id = uc.interest_id AND r.card_type = uc.card_type
            WHERE uc.user_id = ? AND uc.card_type = ? AND uc.seen_at >= ? AND uc.interest_id IS NOT NULL
              AND (r.resumed_at IS NULL OR uc.seen_at > r.resumed_at)
            GROUP BY uc.interest_id`,
      args: [userId, cardType, since],
    });
    for (const r of res.rows as any[]) {
      const interestId = Number(r.interest_id);
      if (existing.some((m) => m.interestId === interestId && m.cardType === cardType)) continue;
      if (!shouldMute(engagementRate(Number(r.shown), Number(r.engaged ?? 0)))) continue;
      await client.execute({
        sql: "INSERT OR IGNORE INTO user_feed_mutes (user_id, interest_id, card_type, muted_at) VALUES (?, ?, ?, ?)",
        args: [userId, interestId, cardType, new Date().toISOString()],
      });
      flipped.push({ interestId, cardType });
    }
  }
  return flipped;
}

/** Runs the sweep at most once a day per person. Returns the current mutes. */
export async function sweepIfDue(userId: number, lastSweep: string | undefined): Promise<MuteKey[]> {
  const today = new Date().toISOString().slice(0, 10);
  if (lastSweep !== today) {
    await runMuteSweep(userId).catch((err) => console.error("[mutes] sweep failed:", err));
    await client.execute({ sql: "UPDATE users SET prefs = json_set(prefs, '$.lastMuteSweep', ?) WHERE id = ?", args: [today, userId] });
  }
  return getMutes(userId);
}

# Launch plan — progress notes

Work is on branch `launch`, **uncommitted**, and **does not build yet** (old code still calls functions that were replaced). Resume from "Next steps".

## Choices made while executing (differ from LAUNCH_PLAN.md)

No outside accounts existed, so each of these was built to run without one:

| Plan said | Built instead | Why |
|---|---|---|
| Postgres (Neon/Supabase) | Stay on SQLite/Turso | Turso is already set up and deployed; no new account, no query rewrite |
| Clerk | Built-in email + password (`src/lib/auth.ts`) | No account needed; Google/Apple sign-in can be added later |
| Inngest | Database job queue (`src/lib/engine/jobs.ts`) + a cron endpoint | No account needed |
| Upstash rate limits | Limits counted in the database | No account needed |
| Batch API / prompt caching | One merged cheap-model call per deep dive instead of three | Bigger saving, simpler |

Safety: `.env.local` points at the live Turso database. Run locally with `NEURON_LOCAL_DB=1` so development never writes to it. A backup of the local DB is at `data/pre-launch-backup.db`.

## Done so far (Phase 12 and part of 13)

- `src/db/schema.ts`, `src/db/migrateV2.ts` — new tables: users, sessions, per-user interests, concepts, cards, user_cards, user_concepts, ai_usage, jobs, reports, push_subscriptions, error_log. Additive only.
- `src/lib/auth.ts` — sign up / in / out, sessions, first account inherits the pre-launch data, account deletion.
- `src/lib/ai.ts` — every Claude call goes through here: fast/main/deep model tiers, cost logged per call, refusal fallback. All generator files now use it.
- `src/lib/interests.ts` — rewritten per user.
- `src/lib/cardTypes.ts` — card types shared with the UI.
- `src/lib/engine/` — `cards.ts`, `expand.ts` (deep dive → bites, concepts, quiz, myth, diagram), `quality.ts` (source check), `series.ts` (shared deep-dive series), `news.ts` (shared news), `jobs.ts` (queue).
- `src/lib/learning.ts` — FSRS scheduling, mastery, knowledge map and score.
- `src/lib/searchIndex.ts` — private content only matches for its owner.

Nothing above has been run or tested yet.

## Next steps

1. Finish Phase 12/13 wiring:
   - `src/lib/plan.ts` (free/pro limits), `src/lib/engine/scheduler.ts` (what the cron tick queues), static cards from the fact / mental-model / brain-game banks, legacy backfill, search reindex; call these from `src/db/bootstrap.ts`.
   - Update `src/lib/libraryPipeline.ts`, `src/lib/digest.ts` detail getters, `src/lib/export.ts` to take a user id.
   - Replace `src/middleware.ts`; add `/login`, `/signup`, `/api/auth/*`, `/api/cron/tick`, `/api/jobs/kick`.
   - Delete the old cycle code: `src/lib/pipeline.ts`, `src/lib/stream.ts`, `src/app/api/refresh/*`, `src/app/archive/*`, `src/components/stream/*`, `RefreshButton.tsx`.
   - Get `npx tsc --noEmit` clean, run migrations on the local DB, commit.
2. Phase 14: `src/lib/rank.ts`, `src/lib/feed.ts`, `/api/feed`, `/api/events`, card components, new home page.
3. Phases 15–18 as written in LAUNCH_PLAN.md.

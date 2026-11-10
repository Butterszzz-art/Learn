# Launch status

Where the app stands against [LAUNCH_PLAN.md](LAUNCH_PLAN.md), as of 10 November 2026.

## How it was verified

- `npm run typecheck`, `npm run build` and `npm test` (56 tests) all pass.
- The tests cover ranking, review scheduling, accounts and lockout, isolation between accounts, feed assembly, event recording, plan limits, the job queue, and the whole generate → source check → expand → feed path.
- Walked through in a browser at phone size: sign-up, onboarding, the swipe feed. Every other page was requested over HTTP while signed in and returned correctly, and the main API flows (events, saving, settings, reports, custom interests, search, share image) were exercised.
- News ingestion from the free research feeds was run for real (24 cards from three fields).

**Not verified: live AI generation.** There was no Anthropic API key on the development machine, so no deep dive has actually been written and expanded by the model through the new pipeline. The path is covered by tests using stand-in responses, and the request code is unchanged from the previous working version apart from model routing. The first real `npm run tick` should be watched — see "First run" below.

## What differs from the plan

The plan named several hosted services. None of the accounts existed, so each piece was built to run without one. All can be swapped later.

| Plan | Built | Trade-off |
|---|---|---|
| Postgres | Stayed on SQLite/Turso | No migration risk and the existing deployment keeps working. Fine well into thousands of users; revisit if writes become a bottleneck |
| Clerk | Built-in email + password | No Google/Apple sign-in, no email verification, **no password reset** (needs an email-sending service) |
| Inngest | Database job queue + cron endpoint | No dashboard beyond the admin page; throughput is bounded by how often the tick runs |
| Upstash rate limits | Limits counted in the database | Fine at this scale |
| Cloudflare R2 for uploads | Not needed | Uploaded files were already deleted from the database once processed |
| Batch API, prompt caching | One merged fast-model call per deep dive (was three main-model calls) | Bigger saving for less complexity. The prompts are too short to benefit from caching |
| Sentry, PostHog | Error log and usage numbers on the admin page | No alerting, no funnels |
| Stripe, RevenueCat | Plan limits and an upgrade page; plans are switched from the admin page | **No payment is taken anywhere yet** |
| Capacitor store builds | Config and instructions only | See [MOBILE.md](MOBILE.md) |
| Placement quiz | Self-placement per field, in plain language | A real per-field quiz needs generated questions for every field and level |
| Figures from papers | Not built | Diagrams are generated; reusing published figures needs per-paper licence checks |
| Playwright browser tests | Not built | Covered by integration tests and a manual walkthrough instead |

One commit covers phases 12–16 rather than one commit per phase: the phases share a schema and could not be built and kept working separately.

## Must do before a public launch

These are the things that would hurt real users if skipped.

1. **Set `ADMIN_EMAIL` before the first deploy.** Otherwise the first person to sign up becomes admin and inherits the existing data.
2. **Add password reset.** Needs an email-sending account (Resend, Postmark or similar). Without it, a forgotten password means a lost account.
3. **Run and watch the first real generation** (see below).
4. **Have the Privacy Policy and Terms reviewed**, and fill in the operator name and contact address. They are drafts written to match what the app does. Both pages are marked in the source.
5. **Fill the pool.** A new reader in a field with no entries yet sees curated cards and a "more is on its way" card. Run `npm run tick -- --minutes 30` a few times first.
6. **Wire up payments** before selling Pro, or leave `NEXT_PUBLIC_BILLING_URL` unset so the page says it isn't on sale.
7. **Schedule ticks more often than daily** if on a paid hosting tier.

## First run with a real API key

1. Add `ANTHROPIC_API_KEY` to `.env.local` yourself, then run `npm run tick`.
2. Open `/admin`. Check that:
   - "Deep dives published" went up, and "held back" is a small fraction. If most are held back, the source check is too strict — the threshold is `FLAG_BELOW` in `src/lib/engine/quality.ts`.
   - "AI spend" shows rows for `series_next` and `news`.
   - "Recent errors" is empty. A message about the refusal-fallback option not being accepted is harmless: the app notes it and carries on without it.
3. Read a couple of the generated entries and their cards end to end. This is the first time the bite-splitting prompt has run against the model, so its output is worth a human look.
4. Compare "Per active user per day" with the $0.03 target once a few people are using it.

## Should do soon after

- Email verification on sign-up.
- Google / Apple sign-in.
- Alerting when daily AI spend passes a threshold.
- Hourly `/api/health` uptime check.
- A weekly pass through the admin report queue.
- Native features for the store builds (see MOBILE.md).
- Health-topic cards (exercise science, neuroscience) rely on the general "not medical advice" terms; a per-card note would be more visible.

# Neuron → Launch Plan

Goal: turn Neuron from a single-user local feed into a launchable app — "TikTok for science learning" whose real promise is *make you the most knowledgeable person in the room*. Fast and addictive to open, but every swipe leaves you knowing something.

This plan is ordered so it can be executed top to bottom, one phase per commit (same style as Phases 7–11). Each phase lists what to build, which files it touches, and when it counts as done.

---

## Where the app is today

What's strong (keep it):
- The content engine: level-matched deep dives with web-search grounding, real abstracts, follow-ups, drills, explain-it-back, mental models, rabbit holes, library ingestion, FTS search, export.
- The swipe stream (`src/components/stream/`) and the "no dark patterns" ethic.

What blocks a launch:

| Area | Problem | Where |
|---|---|---|
| Accounts | No users. One `settings` row (`id = 1`), no `user_id` on any table. Auth is one shared `SITE_PASSWORD` cookie that stores the password itself. | `src/db/schema.ts`, `src/middleware.ts` |
| Cost | Every deep dive / roundup is generated **per user**, with `web_search`, on the most expensive model. 1,000 users × 10 interests/day = 10,000 deep dives/day. Unaffordable. | `src/lib/pipeline.ts`, `src/lib/deepDive.ts` |
| Generation trigger | Content only appears when the user taps **Refresh now** and waits on 60–300s serverless calls. | `src/app/api/refresh/*`, `RefreshButton.tsx` |
| Storage | Uploaded books stored as base64 inside the DB row. | `books.fileBase64` |
| Learning data | Quiz/drill answers are deliberately not saved, and review is a fixed 3→7→21→60 day schedule. Nothing can measure "how much do I know". | `coveredTopics`, `SelfCheckQuiz.tsx` |
| Format | Cards are long-form readers. A TikTok-style feed needs short, visual "bites" with depth on demand. | `src/lib/stream.ts` |
| App shell | Desktop top nav, footer says "runs entirely on your machine", no PWA manifest, no offline, no push. | `layout.tsx`, `Nav.tsx` |
| Quality gates | No tests, no CI, no error tracking, no analytics. README deploy steps reference a `neuro-digest` subfolder that no longer exists. | repo root |

---

## Decisions (defaults chosen — change before executing if you disagree)

1. **Feed feel: "endless but honest."** TikTok-style vertical swipe that keeps going (shared content pool means there is always more), but no streak shaming, and a soft "session recap" every ~15 cards showing what you learned. This replaces the current hard "You're caught up" stop.
2. **Mobile app route: PWA first, then Capacitor** wrapping the same Next.js app for the App Store / Play Store. One codebase. (A React Native rewrite would be weeks of extra work for little gain at this stage.)
3. **Database: Postgres (Neon or Supabase)** instead of Turso/SQLite. Multi-user writes, row-level filtering, `tsvector` full-text search, and `pgvector` for similarity — all in one place. Drizzle supports it, so queries mostly carry over.
4. **Auth: Clerk** (or Supabase Auth if you pick Supabase for the DB). Email + Apple + Google sign-in — Apple sign-in is required by the App Store if you offer Google.
5. **Jobs: Inngest** (or Trigger.dev) for background generation, replacing click-to-refresh.
6. **Business model: freemium.** Free: the shared science feed, quizzes, reviews. Paid ("Neuron Pro"): custom interests, research-level depth, Library uploads, unlimited "ask about this", exports. Stripe on web, RevenueCat for in-app purchases.

---

## Phase 12 — Multi-user foundation

Make the app safe for more than one person.

- Move to Postgres: switch `drizzle.config.ts` and `src/db/index.ts` to `drizzle-orm/node-postgres` (or `neon-http`), port `schema.ts` to `pg-core`, write a one-off script to copy existing SQLite data in.
- Add a `users` table and split the schema into two kinds of tables:
  - **Shared content** (no user): `interests` (seed ones), `items`, `deep_dives`, `drills`, `mental_models`, `brain_facts`, `brain_games`, `rabbit_holes`, plus a new `content_bites` table (Phase 13).
  - **Per-user state** (`user_id` required): `user_interests`, `settings`, `covered_topics` → `user_concept_state`, `explain_backs`, `books`, `book_chapters`, custom interests, a new `card_events` table, saves/bookmarks.
- Add Clerk; replace `src/middleware.ts` with Clerk middleware; add `getUserId()` helper and pass it through every route in `src/app/api/**` and every query in `src/lib/**`. Delete `/login` and `SITE_PASSWORD`.
- Move book files to object storage (Cloudflare R2 or S3); `books.fileBase64` → `books.storageKey`.
- Per-user rate limits and a monthly AI-spend budget (Upstash Redis) on every route that calls Claude.
- Account deletion and data export endpoints (App Store requirement; export already mostly exists in `src/lib/export.ts`).
- Remove `await ensureDb()` from `layout.tsx` and API routes — migrations run at deploy time, not per request.

**Done when:** two accounts can sign up, pick different interests, and never see each other's settings, books, or progress.

## Phase 13 — Shared content engine (the cost and speed fix)

Generate once, serve to everyone. This is the single biggest lever for both cost and speed.

- **Content keyed by `(interest, level, topic)`**, not by user. When a user needs their next deep dive, first look for an existing one at their level that they haven't seen; only generate if none exists.
- **Concept graph:** new `concepts` table (name, interest, difficulty 1–5, short definition) and `concept_edges` (prerequisite / related). Deep dives, bites, drills, and chapters link to concepts. The syllabus progression in `deepDive.ts` walks this graph instead of free-form "what's next" text. This is what powers the knowledge map in Phase 15.
- **Knowledge bites:** new `content_bites` table — the short-form unit of the feed. One deep dive is split into 3–6 bites (hook, one idea, one number, one "why it matters"), each 40–90 words, plus a quick check question. Generated in the same call as the deep dive.
- **Background jobs (Inngest):**
  - Hourly: fetch curated sources (`src/lib/fetchers/*`), dedupe, summarize — once globally, not per user.
  - Nightly: for each popular `(interest, level)`, top up the pool so there are always ≥ 20 unseen bites per active user.
  - On demand: custom interests and follow-ups queue a job; the UI shows a "brewing" card instead of blocking.
  - Library chapter processing moves into jobs too.
- **Model routing and cost controls** (`src/lib/claude.ts` becomes the single entry point):
  - Small/fast model (Haiku) for classify, summarize, bite splitting, quiz writing, explain-back feedback.
  - Sonnet for deep dives and roundups; Opus only for research-level dives.
  - Prompt caching on the long system prompts.
  - Batch API (50% cheaper) for the nightly pool top-up.
  - Log tokens and cost per call into an `ai_usage` table.
- **Quality pass:** a cheap second call checks each deep dive against its own sources (claims cited, numbers match, no dead links) and flags or rejects it. Track a `quality_score` per piece. Add a "Report an error" button on every card.
- Retire the per-step refresh routes in `src/app/api/refresh/*` and `RefreshButton.tsx` (keep a hidden admin trigger).

**Done when:** a new user's feed is full within 2 seconds of finishing onboarding with zero Claude calls on that request, and average AI cost per active user per day is tracked and below the target you set (aim for < $0.03).

## Phase 14 — The TikTok-style feed

- **Feed API:** `GET /api/feed?cursor=` returns the next 10 cards. Replace the "whole cycle at once" model in `src/lib/stream.ts` and `src/app/page.tsx` with cursor pagination; prefetch the next page at card 7.
- **Ranking** (`src/lib/rank.ts`, new): score each candidate card on
  - interest match and level fit,
  - freshness (news decays fast, concepts don't),
  - predicted engagement from the user's own signals,
  - exploration (≈ 15% of cards from adjacent concepts or outside interests — evolves Rabbit Hole into a steady trickle),
  - learning value (cards whose prerequisites you already know rank higher; due reviews get injected every ~5 cards).
- **Signals:** new `card_events` table — `impression`, `dwell_ms`, `completed`, `expanded`, `saved`, `shared`, `skipped_fast`, `quiz_correct/incorrect`, `go_deeper`. Batched from the client every few seconds (`navigator.sendBeacon`).
- **Depth on demand:** every bite has a "Go deeper" action that opens the full deep dive as a bottom sheet, and a "Next in this thread" swipe-right that follows the same concept chain (a TikTok "series").
- **Card templates** (`src/components/cards/`, replacing the many one-off card components):
  - **Bite** — hook headline, 2–4 lines, one highlighted key number or term.
  - **Paper** — finding in one sentence, effect size / sample size chips, "peer-reviewed / preprint / news" badge, link.
  - **Visual** — diagram or figure (generated Mermaid/SVG, or figure image from open-access papers) with a caption.
  - **Quiz** — one question, tap to answer, instant feedback, answer saved.
  - **Debate** — claim vs. the steelman, side by side (from `steelman.ts`).
  - **Timeline / Myth vs fact / Mental model** — specialized layouts for the existing content types.
  - **Recap** — every ~15 cards: "You learned 6 things" with the concepts listed.
- Performance: render only current ± 2 cards (virtualized), keep CSS scroll-snap, lazy-load images, keep gestures at 60fps on mid-range Android.

**Done when:** you can swipe for 10 minutes straight with no loading spinner, and the cards you get visibly adapt after you skip or save a few.

## Phase 15 — "Most knowledgeable person" learning layer

This is what separates Neuron from doomscrolling.

- **Save answers.** Quizzes, drills, and recall cards write results to `user_concept_state` (replaces "nothing persisted" in `SelfCheckQuiz.tsx` / `DrillCard.tsx`).
- **FSRS spaced repetition** (`ts-fsrs` package) replaces the fixed 3→7→21→60 schedule in `coveredTopics`. Reviews are woven into the feed as quick recall cards.
- **Knowledge map** page (`/map`): your concept graph per interest, nodes shaded by mastery (unseen → seen → recalled → mastered). Tap a node to review or go deeper. This is the "how much do I know" screen.
- **Knowledge score:** a per-interest number of concepts mastered, plus a weekly "you now know X things most people don't" recap card. Shareable as an image.
- **Ask about this:** a chat sheet on every card, grounded on that card's content and sources (Haiku by default, rate-limited on free tier).
- **Learning paths:** curated sequences through the concept graph ("Neuroscience of sleep in 7 days"), shown on the Explore tab.
- **Explain-it-back rubric:** keep the supportive feedback, add a private 3-level rating (gaps / solid / could teach it) that feeds mastery.
- Keep the existing ethic: daily goal is optional, streaks are opt-in and forgiving (one free skip per week), no guilt notifications.

**Done when:** after a week of use, the knowledge map shows real mastery changes driven by quiz and recall results.

## Phase 16 — App UI and information display

- **Navigation:** mobile bottom tab bar — **Feed · Explore · Review · Library · Me**. Search moves into Explore. Desktop keeps a left rail. Rewrite `Nav.tsx`; drop the "runs entirely on your machine" footer.
- **Design tokens:** formalize colors, type scale, spacing, radius, and motion in `tailwind.config.ts` + `globals.css`; add dark mode (most TikTok-style use is at night); respect reduced-motion.
- **Information layering** on every piece: headline → one-line takeaway → 3 bullets → full text → sources. Readers choose how deep to go; the feed shows only the first two layers.
- **Trust display:** source badges (peer-reviewed / preprint / journalism / AI-synthesized), publication date, "evidence strength" chip for scientific claims, and a visible sources list. Being trusted is part of "most knowledgeable".
- **Visual content:** render Mermaid/SVG diagrams in cards, pull open-access figures where licensing allows, and use consistent per-interest colors and icons.
- **Audio:** optional "listen" mode (TTS) for deep dives and bites — good for commutes.
- **Explore tab:** trending topics, learning paths, interest browsing, "what people are learning" (anonymous counts).
- **Me tab:** knowledge score, map, saved cards, settings, subscription.
- **Onboarding:** 60 seconds — pick 3+ interests from visual tiles, a 3-question placement quiz sets level, first card shows immediately.
- **Share cards:** export any bite as a branded vertical image (`@vercel/og`) for Instagram/TikTok — free growth loop.
- Accessibility pass: contrast, focus order, screen-reader labels on swipe controls, text size setting.

**Done when:** a first-time user on a phone gets from install to their first card in under a minute, and every card type works in light and dark mode.

## Phase 17 — Mobile app packaging

- **PWA:** `manifest.webmanifest`, icons, splash screens, service worker (Serwist) that caches the next 30 cards for offline/subway use.
- **Capacitor** wrap for iOS and Android: native share sheet, haptics on quiz answers, status bar styling, deep links (`neuron://card/123`).
- **Push notifications** (OneSignal or Firebase): one optional daily nudge at a time the user picks ("3 reviews ready", "New finding in Neuroscience"). Never more than one a day by default.
- In-app purchases through RevenueCat; Stripe for web.
- Store assets: screenshots, preview video, description, privacy nutrition labels.

**Done when:** TestFlight and Play internal-testing builds install and run the full flow, including offline feed and a test purchase.

## Phase 18 — Launch readiness

- **Tests:** Vitest for `rank.ts`, FSRS scheduling, parsing in `deepDive.ts`/`epub.ts`, dedupe; Playwright for onboarding → feed → quiz → review.
- **CI:** GitHub Actions — typecheck, lint, tests, build on every PR.
- **Monitoring:** Sentry (errors), PostHog (product analytics + feature flags), Inngest dashboard (jobs), daily AI cost alert.
- **Performance budgets:** feed first card < 1.5s on 4G, JS bundle < 200KB for the feed route, Lighthouse ≥ 90 mobile.
- **Database:** indexes on every `user_id` + date column, on `(interest_id, level)` for the content pool, and on `card_events(user_id, created_at)`.
- **Legal and safety:**
  - Privacy policy, terms, age rating (13+ unless you build a kids mode).
  - Library uploads: personal-use only, files private to the uploader, never added to the shared pool.
  - AI-content disclosure on generated cards; "Report an error" queue reviewed weekly.
  - Medical/health content gets a "not medical advice" note (exercise science, neuroscience).
- **Admin page** (`/admin`, role-gated): content queue, flagged cards, quality scores, AI spend, active users.
- Fix README: real setup and deploy steps for the new stack.

**Done when:** CI is green, a staging environment mirrors production, and the store submissions are filed.

---

## What only you can do

These need your own accounts or payment and can't be done by an assistant:
- Create accounts: Neon/Supabase, Clerk, Inngest, Cloudflare R2, Upstash, Sentry, PostHog, Stripe, RevenueCat.
- Apple Developer Program ($99/yr) and Google Play Console ($25 once).
- Put API keys into Vercel / `.env.local` yourself.
- Approve the privacy policy and terms (ideally with a lawyer's look).
- Choose the price for Neuron Pro.

## Suggested order of execution

12 → 13 → 14 → 15 → 16 → 17 → 18. Phases 15 and 16 can be built in parallel once 14 is in (different files). Phase 12 has to come first — everything else assumes `user_id` exists.

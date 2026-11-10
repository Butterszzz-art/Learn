# Neuron

A swipe feed for science and ideas. Same thumb motion as any other feed, except every card teaches one real thing — and the app keeps track of what you actually remember.

- **Feed** — one card per screen: short "bites" drawn from long-form explainers, research summaries with their source and evidence type, diagrams, myth-vs-fact, quick-check questions, and the strongest counterargument to contested claims. It adapts to what you finish, save and skip.
- **Depth on demand** — every bite opens the full, sourced explainer behind it. From there: self-check questions, explain-it-back with feedback, follow-up topics, and "ask about this".
- **Levels** — each field is followed at one of four levels, from first principles to research frontier, and is a sequence that builds on itself.
- **Memory** — quiz answers and recall checks feed a spaced-repetition schedule (FSRS). Reviews are woven into the feed and collected on the Review tab.
- **Knowledge map and score** — every idea in your fields, shaded by how well you've retained it.
- **Library** — upload a PDF/EPUB or paste an article link for private chapter-by-chapter notes, released into your feed at a pace you set.
- **Installable** — works as a home-screen app with offline reading of loaded cards and an optional once-a-day reminder.

---

## How it works

```
 curated feeds ─┐                    ┌─ bites, quiz, diagram, myth, insight
 web search ────┼─► deep dive ─► source check ─► expand ─┤
 (per interest  │   (once per          │                 └─ concepts + prerequisites
  and level)    │    topic)         held back if                    │
                └────────────────── unsupported                     ▼
                                                            shared card pool
                                                                    │
            per person: interests, levels, what they've seen, ──► ranked feed
            quiz answers, review schedule
```

The key design decision is that **content is shared and state is personal**. A deep dive is researched and written once for an (interest, level) pair and served to everyone at that level; only the ranking, the seen/answered state and the review schedule are per person. Cost therefore grows with the number of topics covered, not the number of users.

| Area | Where |
|---|---|
| Accounts, sessions, account deletion | `src/lib/auth.ts`, `src/middleware.ts` |
| All Claude calls: model tiers, cost logging | `src/lib/ai.ts` |
| Content engine: series, expansion, source check, news, queue, scheduler | `src/lib/engine/` |
| Feed assembly and event recording | `src/lib/feed.ts` |
| Ranking (pure, unit-tested) | `src/lib/rank.ts` |
| Spaced repetition, mastery, knowledge map | `src/lib/learning.ts` |
| Plan limits | `src/lib/plan.ts` |
| Schema and migrations | `src/db/schema.ts`, `src/db/migrate.ts`, `src/db/migrateV2.ts` |
| Feed UI and card layouts | `src/components/feed/` |

**Models.** Three tiers, set in `src/lib/ai.ts` and overridable by environment variable: a fast model for summaries, bite splitting, quizzes, feedback and Q&A; a main model for deep dives and web-searched roundups; a deep model for research-level entries. Every call's token usage and estimated cost is written to `ai_usage` and shown on the admin page, including cost per active user per day.

**Generation runs in the background.** A scheduler decides what the pool is short of (it keeps a few entries ahead of the furthest reader in each series, and refreshes news on a timer) and queues jobs; `/api/cron/tick` works through the queue. A person waiting on an on-demand topic nudges the queue themselves, so they aren't stuck until the next tick.

**Quality.** Before an entry is served, its source links are checked and a second model reads it against the fetched source text. Entries that score low are held back for an admin to review. Every card has a report button; a card reported by several readers is hidden until someone looks.

---

## Run it locally

Requires Node 20+.

```bash
npm install
```

```bash
npm run seed:demo
```

```bash
npm run dev:local
```

Open http://localhost:3000, create an account, and pick some interests. The first account becomes the admin (see `/admin`).

- `dev:local` always uses the local SQLite file at `./data/neuro-digest.db`, even if hosted database credentials are in `.env.local`. The schema and the built-in fact / mental-model banks are created automatically on first request.
- `seed:demo` adds two short hand-written entries so there is something to swipe through without an API key.
- To generate real content, copy `.env.example` to `.env.local`, add your `ANTHROPIC_API_KEY` yourself, and run `npm run tick` (or use "Run a generation tick now" on the admin page).

| Command | What it does |
|---|---|
| `npm run dev:local` | Dev server on the local database |
| `npm run dev` | Dev server on whatever `.env.local` points at |
| `npm test` | Unit and integration tests (throwaway database, no AI calls) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Production build |
| `npm run tick` | Plan and run background generation from the command line |
| `npm run tick -- --minutes 30` | A longer run, e.g. to fill the pool before launch |
| `npm run seed:demo` | Demo content (local database only) |
| `npm run db:migrate` | Apply schema changes |
| `npm run push:keys` | Generate keys for push notifications |

---

## Deploy

The app is a standard Next.js app with a libSQL (Turso) database.

1. **Database** — create a Turso database and note its URL and an auth token that doesn't expire.
2. **Host** — import the repository into Vercel (framework preset: Next.js, root directory: the repository root).
3. **Environment variables** — set these in the host's dashboard. Enter the values yourself; don't paste secrets into a chat.

   | Variable | Needed | Purpose |
   |---|---|---|
   | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Yes | Database |
   | `ANTHROPIC_API_KEY` | Yes | Content generation |
   | `ADMIN_EMAIL` | Yes | Which account is the admin. Set it **before** the first deploy, or whoever signs up first becomes admin |
   | `CRON_SECRET` | Yes | Protects the scheduled generation endpoint |
   | `TICK_BUDGET_MS` | Optional | How long a tick may run. Default 45000 fits a 60-second function limit; raise it on a plan with longer functions |
   | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Optional | Push notifications |
   | `NEXT_PUBLIC_BILLING_URL` | Optional | Checkout link for the upgrade page |

4. **Schema** — tables are created and upgraded automatically on the first request after each deploy. The upgrade is additive: it adds tables and columns and never rewrites existing rows.
5. **Scheduled generation** — `vercel.json` runs `/api/cron/tick` once a day, which is the most the free Vercel tier allows. On a paid tier, change the schedule to hourly (`0 * * * *`) and raise `TICK_BUDGET_MS`. Any external scheduler can call the endpoint too, with `Authorization: Bearer <CRON_SECRET>`.
6. **Fill the pool before inviting people** — run `npm run tick -- --minutes 30` from your machine with the production variables set, a few times, so new readers land on a full feed.

**Upgrading an existing single-user deployment:** the account that signs up with `ADMIN_EMAIL` inherits the previous interests, Library and explain-it-back history. Existing deep dives stay and are expanded into cards by the scheduler over the first few ticks. The old `SITE_PASSWORD` variable is no longer used and can be removed.

Mobile app packaging is covered in [docs/MOBILE.md](docs/MOBILE.md). What is finished and what still needs doing before a public launch is in [docs/LAUNCH_STATUS.md](docs/LAUNCH_STATUS.md).

# Neuron

A personal, local knowledge feed — a doomscrolling replacement. It surfaces
real current material *and* thorough, level-matched explainers across ANY
field you choose, at any depth up to genuine research level, plus concrete
takeaways for applying it to daily life. Runs entirely on your own machine.
No hosting, no email, no account required.

- **Interests, wide open**: 17 seeded fields (Neuroscience & Psychobiology,
  Psychology, Philosophy, History, Economics & Finance, Business, Political
  Science, Computer Science / AI, Physics, Critical Thinking &
  Argumentation, Exercise Science, Philosophy of Science, Mathematics,
  Logic, Animal World, Biology, Evolution) are suggestions, not a ceiling —
  type any topic of your own in onboarding or Settings and it gets the full
  treatment. Set a level per interest: *new to this*, *some background*,
  *advanced*, or *research level*.
- **No depth ceiling**: below research level, each interest's deep dives keep
  escalating in sophistication over weeks/months of use — the series tracks
  what it's already covered and pushes a bit further each time, the way a
  real course sequence would, rather than plateauing at an intro level
  forever. *Research level* skips that ramp and goes straight to lit-review
  register — open questions, current debates, recent papers.
- **News, for every field**: interests with a registered RSS/API source (all
  the original seven except Business and Political Science) use it. Every
  other interest — Business, Political Science, or anything you typed
  yourself — gets a Claude-generated **Field News Roundup** instead: 3-5
  real, current, web-search-verified developments, each with a genuine
  source link, summarized in the app's own words.
- **Deep dives**: once per digest cycle, per enabled interest, Claude — with
  the `web_search` tool — writes one genuinely thorough, several-hundred-word
  explainer on the next logical syllabus topic, grounded in real current
  sources. Calibrated to your level, but never condescending — level only
  changes which concepts are assumed as background, not the register.
- **Applied Insights**: for interests where it makes sense (Psychology,
  Business, Economics & Finance, Philosophy, and Neuroscience by default;
  toggle any interest in Settings), one short, concrete, actionable
  daily-life takeaway is generated off each deep dive — skipped entirely
  when a topic genuinely doesn't have a natural one. Quality over
  completeness.
- **Bounded feed**: the home page groups content by interest, and within
  each interest into three clearly labeled sections — News, Deep Dive,
  Applied Insight — most substantial first. Once you've seen everything in
  the current cycle, you get a clear "You're caught up" end state. Nothing
  lazy-loads just to keep you scrolling.
- **Storage**: a single SQLite file at `./data/neuro-digest.db` (via
  `@libsql/client` + Drizzle ORM — no native build tools required, works
  out of the box on Windows). Nothing leaves your machine except the
  outbound fetches to public feeds/APIs, and — for deep dives, insights,
  and news roundups — requests to the Anthropic API.
- **Curiosity branching**: every deep dive ends with 2-3 clickable follow-up
  cards — natural next subtopics it raised, each with a one-line teaser.
  Clicking one generates and opens that specific entry immediately, for any
  interest, not waiting for the next cycle.
- **Passion Mode**: star any interest (feed or Settings) to get more than
  one deep dive per cycle, framed one notch more advanced than its stored
  level, plus two on-demand feed controls — **Binge** (algorithm picks,
  generates now) and **pick your next topic** (see 2-3 candidates, choose
  one yourself).
- **Retention tools**: each deep dive ends with a 2-3 question self-check —
  multiple choice, reveals right/wrong plus a one-line explanation
  immediately, no score kept or sent anywhere. Topics you've covered
  resurface later on a simple fixed schedule (3 → 7 → 21 → 60 days) as a
  "Remember this?" card — a recall prompt first, a refresher from the
  original entry on request. A plain, non-punitive progress count ("14
  concepts covered this month across 3 interests") sits at the top of the
  feed — never a streak, never framed as being "at risk."
- **Drills**: critical-thinking/logic practice — spot the fallacy,
  reconstruct the argument, check validity, or strengthen/weaken it.
  Grounded in real content whenever possible: each cycle, 1-2 drills are
  built from an actual argument or claim found in a recent deep dive
  (any interest), with a link back to it. Plus one standalone formal-logic
  drill per cycle (syllogisms, validity vs. soundness, formal fallacies)
  for Critical Thinking & Argumentation and/or Logic, which share drill
  material rather than repeating each other. Same instant-feedback,
  nothing-persisted UI as the self-check questions; drilled concepts feed
  into the same spaced-resurfacing system as deep-dive topics.

---

## Setup

```bash
cd neuro-digest
npm install
npm run db:migrate         # creates/updates the SQLite schema in ./data/neuro-digest.db
npm run db:seed-interests  # loads the 9 seed interests
npm run db:seed            # loads the curated brain-fact bank
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). First run takes you
through onboarding — pick your interests (or type your own) and levels —
then click **Refresh now** to compile your first cycle.

### Enabling AI features (needs an API key)

Deep dives, applied insights, and News for any interest without a curated
source (custom interests, Business, Political Science) all **require** an
Anthropic API key — curated News still works without one.

1. Copy `.env.example` to `.env.local`.
2. Set `ANTHROPIC_API_KEY=sk-ant-...` (get one from
   [platform.claude.com](https://platform.claude.com)). **Add it yourself** —
   don't paste it into a chat with an AI assistant and ask it to write the
   file for you.
3. Optionally set `ANTHROPIC_MODEL` to a different model ID — defaults to
   `claude-sonnet-5`.
4. Restart `npm run dev`.

---

## Deploying it as a website (Vercel + Turso)

The app runs great purely locally (see **Setup** above) — this section is
only for making it a real URL you can open from your phone, with your own
data persisted in the cloud instead of a local file.

Two accounts are needed, both free to start, and you have to create/link
them yourself (they require your own login/OAuth consent — no assistant can
do this step for you):

1. **[Turso](https://turso.tech)** — hosted SQLite. Replaces the local
   `./data/neuro-digest.db` file, since Vercel's serverless filesystem is
   read-only/ephemeral and can't hold a local SQLite file between requests.
2. **[Vercel](https://vercel.com)** — hosting, connected directly to this
   GitHub repo so every push to `main` auto-deploys.

### 1. Create the Turso database

Install the CLI (native Windows isn't supported — run this from WSL, Git
Bash won't work for the installer itself, though the resulting `turso`
binary works fine from any shell once it's on your `PATH`):

```bash
curl -sSfL https://get.tur.so/install.sh | bash
turso auth login
turso db create digest
turso db show digest --url                              # -> TURSO_DATABASE_URL
turso db tokens create digest --expiration never         # -> TURSO_AUTH_TOKEN
```

`--expiration never` matters here — the default token expires, and you
don't want the deployed app to silently lose database access weeks later.

Apply the schema to the new hosted database once, from your machine:

```bash
TURSO_DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." npm run db:migrate
TURSO_DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." npm run db:seed-interests
TURSO_DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." npm run db:seed
```

That gives the hosted DB the same clean, pre-onboarding state (9 seed
interests, curated brain-fact bank, no user data) that a fresh local
install starts from.

### 2. Import the repo into Vercel

In the Vercel dashboard: **Add New… → Project → Import Git Repository**,
pick `Butterszzz-art/Learn`, and set the **Root Directory** to
`neuro-digest` (the Next.js app lives in that subfolder, not the repo
root). Framework preset auto-detects as Next.js — leave build/output
settings default.

### 3. Set environment variables

In the Vercel project's **Settings → Environment Variables**, add (all as
plain values, not secrets-file uploads — set them directly in Vercel's own
dashboard, never by handing the values to an assistant to write into a
file):

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your key from [platform.claude.com](https://platform.claude.com) — required for deep dives, applied insights, and News for any interest without a curated RSS source |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` (or omit — that's the default) |
| `TURSO_DATABASE_URL` | from step 1 |
| `TURSO_AUTH_TOKEN` | from step 1 |
| `SITE_PASSWORD` | any password of your choosing — gates the whole site behind a login page. Omit this var entirely to leave the site open to anyone with the URL. |

Redeploy after adding/changing env vars (Vercel does this automatically on
the next push, or trigger one manually from the dashboard).

### 4. Open it on your phone

The deployed URL works fully on mobile — onboarding, settings, refresh, and
the feed are all responsive. Add it to your home screen from the mobile
browser's share menu for an app-like shortcut.

### Notes on the deployed refresh flow

- The **Refresh now** button calls one small API route per interest per
  step (News, Deep Dive, Applied Insight) rather than one big call, so that
  a slow Claude generation for one interest can't block or time out the
  others. This matters because of Vercel's function time limits:
  **Hobby tier hard-caps every function at 60 seconds**, no matter what
  `maxDuration` is configured to — Pro tier allows up to 300s. Deep-dive
  generation (`web_search` + a long-form write-up) can occasionally run
  close to or past 60s on Hobby for a research-level entry or a
  source-heavy interest.
- Every step is **idempotent** — it checks what already exists for the
  current cycle before generating anything. So if a step times out on
  Hobby, clicking **Refresh now** again simply picks up where it left off
  instead of duplicating or losing progress.
- If you hit timeouts often on Hobby, either upgrade that Vercel project to
  Pro, or just get in the habit of clicking Refresh twice.

---

## How it works

- **Refresh** (the button in the UI, or `npm run fetch` from the CLI) does,
  for every enabled interest, in parallel:
  1. **News** — curated fetch (dedupe, score, keep the top ~8) for
     interests with a registered source; a Claude+`web_search` Field News
     Roundup (3-5 items, capped) for everything else.
  2. **Deep Dive** — if this cycle hasn't reached its quota yet (1 normally,
     2 for a favorited/Passion Mode interest), Claude picks the next
     syllabus topic (escalating in depth as the series grows, unless the
     interest is at research level) and writes the explainer, plus its
     follow-up topics and self-check questions.
  3. **Applied Insight** — one per deep dive written this cycle, for
     interests that generate them, or nothing if a given topic doesn't have
     a natural everyday application.
- **Cycles**: one compiled period — daily or weekly, per Settings.
  Refreshing multiple times within the same day/week adds new News items to
  the *same* cycle; Deep Dive and Applied Insight are capped at their quota
  per interest per cycle regardless of how many times you refresh (see
  Passion Mode above for what raises that quota above 1). Curiosity
  branching, Binge, and pick-your-next-topic all add *extra* dives on top of
  that quota, on demand — they're not capped by it. This is what makes
  "You're caught up" mean something even with Passion Mode's larger quota.
- **Brain Fact of the Day**: a Phase 1 holdover — still shown at the top of
  the feed, but only when Neuroscience & Psychobiology is enabled. Picked
  from a 75+ entry seed bank, rotated once per day; the bank grows by a
  handful of Claude-generated (plausibility-checked) facts about once a
  week if a key is set.
- **Archive**: every past cycle is kept and browsable by date, showing
  everything that was in it at the time — including from interests you've
  since disabled.
- **Settings**: add custom interests, change levels (including toggling
  research level), enable/disable interests, override whether an interest
  generates Applied Insights, or switch daily/weekly cycles — all from one
  page.

---

## Hands-off updates (optional)

The **Refresh now** button always works, no scheduler required. If you'd
rather it update automatically every morning, `npm run fetch` runs the exact
same pipeline outside the web server, so you can hook it into your OS's own
scheduler.

### Windows (Task Scheduler)

1. Open **Task Scheduler** → **Create Basic Task…**
2. Trigger: **Daily**, at whatever time you want.
3. Action: **Start a program**
   - Program/script: `npm.cmd` (find the full path via `where npm`)
   - Add arguments: `run fetch`
   - Start in: this project folder, e.g. `C:\Users\you\Learn\neuro-digest`

### macOS / Linux (cron)

```bash
crontab -e
```

```
0 7 * * * cd /path/to/neuro-digest && /usr/local/bin/npm run fetch >> /tmp/digest.log 2>&1
```

---

## Project structure

```
src/
  db/
    schema.ts          Drizzle schema: interests, user_interests,
                        covered_topics, deep_dives, applied_insights,
                        items, digests (cycles), brain_facts, settings
    interestsSeed.ts    The 9 seed interests + their applied-insight defaults
    brainFactsSeed.ts   75+ curated brain facts
  lib/
    fetchers/           One fetcher per curated interest, plus a registry
                        mapping interest slug -> fetcher
    interests.ts        Interest config (level/enabled/custom), covered-
                        topics log (recent + total count, for escalation)
    claude.ts           Categorize/summarize items (Claude, keyword fallback)
    deepDive.ts         Deep-dive + applied-insight generation (web_search)
    newsRoundup.ts       Field News Roundup generation (web_search)
    dedupe.ts           URL + fuzzy-title deduplication
    score.ts            Per-interest item ranking
    pipeline.ts         Orchestrates News + Deep Dive + Applied Insight,
                        per interest, per cycle
    digest.ts           Read-side feed/archive/settings queries
  app/                  Next.js App Router pages + API routes
  components/           UI components (Feed, DeepDiveCard, ItemCard,
                        AppliedInsightCard, InterestPicker, ...)
scripts/fetch.ts        Standalone fetch-and-compile script (cron/Task Scheduler)
```

## Backing up your archive

The whole app is a single SQLite file at `./data/neuro-digest.db`. Copy it
to keep your feed archive, deep-dive history, custom interests, and
covered-topics progression when reinstalling or moving machines.

## A note on the RSS/API feed URLs

Every feed in `src/lib/fetchers/` was verified to resolve at the time this
project was generated (one, NBER's, redirects — `fetch()` follows it
automatically). Publishers occasionally change feed paths; if one starts
404ing, check the site's own `/rss` or `/feed` listing page for the
replacement. Custom interests and Business/Political Science don't have
this concern — their News comes from a live web search each cycle.

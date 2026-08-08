# Digest

A personal, local knowledge feed — a doomscrolling replacement. It surfaces
real current material *and* thorough, level-matched explainers across ANY
field you choose, at any depth up to genuine research level, plus concrete
takeaways for applying it to daily life. Runs entirely on your own machine.
No hosting, no email, no account required.

- **Interests, wide open**: nine seeded fields (Neuroscience & Psychobiology,
  Psychology, Philosophy, History, Economics & Finance, Business, Political
  Science, Computer Science / AI, Physics) are suggestions, not a ceiling —
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

---

## Setup

```bash
cd neuro-digest
npm install
npm run db:migrate   # creates/updates the SQLite schema in ./data/neuro-digest.db
npm run db:seed      # loads the curated brain-fact bank (Neuroscience only)
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

## How it works

- **Refresh** (the button in the UI, or `npm run fetch` from the CLI) does,
  for every enabled interest, in parallel:
  1. **News** — curated fetch (dedupe, score, keep the top ~8) for
     interests with a registered source; a Claude+`web_search` Field News
     Roundup (3-5 items, capped) for everything else.
  2. **Deep Dive** — if this cycle doesn't already have one, Claude picks
     the next syllabus topic (escalating in depth as the series grows,
     unless the interest is at research level) and writes the explainer.
  3. **Applied Insight** — if the interest generates them and a deep dive
     was just written, one short takeaway card, or nothing if the topic
     doesn't have a natural everyday application.
- **Cycles**: one compiled period — daily or weekly, per Settings.
  Refreshing multiple times within the same day/week adds new News items to
  the *same* cycle; Deep Dive and Applied Insight are capped at one each per
  interest per cycle regardless of how many times you refresh. This is what
  makes "You're caught up" mean something.
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

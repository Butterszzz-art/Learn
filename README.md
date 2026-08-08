# Digest

A personal, local knowledge feed — a doomscrolling replacement. It surfaces
real current material *and* thorough, level-matched explainers across
whatever fields you choose, not just neuroscience. Runs entirely on your own
machine. No hosting, no email, no account required.

- **Interests**: pick any number of fields — Neuroscience & Psychobiology,
  Psychology, Philosophy, History, Economics & Finance, Business, Political
  Science, Computer Science / AI, Physics — and set a level for each: *new to
  this*, *some background*, or *advanced*. Add more later from Settings.
- **Curated items**: for every enabled interest with a curated source (all of
  them except Business and Political Science), pulls recent items from
  PubMed, arXiv, bioRxiv, and a set of RSS feeds specific to that field —
  deduplicated, scored, and capped per interest so the feed stays substantive
  rather than exhaustive.
- **Deep dives** (the "actually learn something" feature): once per digest
  cycle, for every enabled interest, asks Claude — with the `web_search` tool
  — to write one genuinely thorough, several-hundred-word explainer, grounded
  in real current sources, on the next logical topic in that field's ongoing
  "syllabus" (it tracks what's already been covered so it builds rather than
  repeats or jumps randomly). Calibrated to your level, but never
  condescending — level only changes which concepts are assumed as
  background, not the register.
- **Bounded feed**: the home page is a single feed mixing curated items and
  deep-dive cards from all your enabled interests, most substantial/recent
  first. Once you've seen everything in the current cycle, you get a clear
  "You're caught up" end state — nothing lazy-loads just to keep you
  scrolling. That's the whole point.
- **Storage**: a single SQLite file at `./data/neuro-digest.db` (via
  `@libsql/client` + Drizzle ORM — no native build tools required, works
  out of the box on Windows). Nothing leaves your machine except the
  outbound fetches to public feeds/APIs, and — for deep dives — requests to
  the Anthropic API.

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
through onboarding — pick your interests and levels — then click **Refresh
now** to compile your first cycle.

### Enabling deep dives (needs an API key)

Deep-dive generation is the core feature and **requires** an Anthropic API
key — curated items work fine without one, but you'll only get half the
feed.

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

- **Refresh** (the button in the UI, or `npm run fetch` from the CLI) does
  two things per enabled interest, in parallel:
  1. **Curated fetch** — pulls from that interest's sources, dedupes against
     everything already seen, scores what's left, and keeps the top ~8 most
     substantive new items.
  2. **Deep dive** — if one hasn't already been generated for the *current
     cycle*, asks Claude (with `web_search`) to pick the next syllabus topic
     and write the explainer, then logs the topic so it's never repeated.
- **Cycles**: a cycle is one compiled period — daily or weekly, per Settings.
  Refreshing multiple times within the same day/week adds new curated items
  to the *same* cycle rather than creating a new one each time; deep dives
  are capped at one per interest per cycle regardless of how many times you
  refresh. This is what makes "You're caught up" mean something.
- **Brain Fact of the Day**: a Phase 1 holdover — still shown at the top of
  the feed, but only when Neuroscience & Psychobiology is one of your
  enabled interests. Picked from a 75+ entry seed bank (never-shown facts
  first), rotated once per day; if a key is set, the bank grows by a
  handful of Claude-generated (plausibility-checked) facts about once a
  week.
- **Archive**: every past cycle is kept and browsable by date, showing
  everything that was in it at the time — including from interests you've
  since disabled.
- **Settings**: change your interest levels, enable/disable interests, or
  toggle daily/weekly cycles, all from one page.

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
                        covered_topics, deep_dives, items, digests
                        (cycles), brain_facts, settings
    interestsSeed.ts    The 9 seed interests
    brainFactsSeed.ts   75+ curated brain facts
  lib/
    fetchers/           One fetcher per curated interest, plus a registry
                        mapping interest slug -> fetcher
    interests.ts        Interest config (enable/level), covered-topics log
    claude.ts           Categorize/summarize items (Claude, keyword fallback)
    deepDive.ts         Deep-dive generation via the web_search tool
    dedupe.ts           URL + fuzzy-title deduplication
    score.ts            Per-interest item ranking
    pipeline.ts         Orchestrates fetch -> dedupe -> score -> deep dive
    digest.ts           Read-side feed/archive/settings queries
  app/                  Next.js App Router pages + API routes
  components/           UI components (Feed, DeepDiveCard, ItemCard,
                        InterestPicker, ...)
scripts/fetch.ts        Standalone fetch-and-compile script (cron/Task Scheduler)
```

## Backing up your archive

The whole app is a single SQLite file at `./data/neuro-digest.db`. Copy it
to keep your feed archive, deep-dive history, and interest config when
reinstalling or moving machines.

## A note on the RSS/API feed URLs

Every feed in `src/lib/fetchers/` was verified to resolve at the time this
project was generated (one, NBER's, redirects — `fetch()` follows it
automatically). Publishers occasionally change feed paths; if one starts
404ing, check the site's own `/rss` or `/feed` listing page for the
replacement.

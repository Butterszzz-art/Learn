# Neuro Digest

A personal, automated news digest for neuroscience and psychobiology — runs
entirely on your own machine. No hosting, no email, no account required.

- **Content pipeline**: pulls recent items from PubMed, arXiv (`q-bio.NC` +
  a quantum-biology/brain crossover query), bioRxiv's neuroscience feed, and
  five science-journalism RSS feeds (Quanta, ScienceDaily ×3, MIT News).
- **Storage**: a single SQLite file at `./data/neuro-digest.db` (via
  `better-sqlite3` + Drizzle ORM). Nothing leaves your machine except the
  outbound fetches to those public feeds/APIs, and — if you set an API key —
  requests to the Anthropic API for summarization.
- **AI features (optional)**: with an `ANTHROPIC_API_KEY` set, Claude
  categorizes and writes 2–3 sentence plain-language summaries for each
  item, and periodically (about once a week) proposes new candidate "Brain
  Fact of the Day" entries. Without a key, the app falls back to
  keyword-based categorization and truncated-snippet summaries, and only
  ever shows the 75+ curated seed facts — nothing is generated live.

---

## Setup

```bash
cd neuro-digest
npm install
npm run db:migrate   # creates the SQLite schema in ./data/neuro-digest.db
npm run db:seed      # loads the curated brain-fact bank
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and click **Refresh
now** to compile your first digest.

### Enabling AI summaries (optional)

1. Copy `.env.example` to `.env.local`.
2. Set `ANTHROPIC_API_KEY=sk-ant-...` (get one from
   [platform.claude.com](https://platform.claude.com)).
3. Optionally set `ANTHROPIC_MODEL` to a different model ID — defaults to
   `claude-sonnet-5`.
4. Restart `npm run dev`.

Without a key, everything still works: items are sorted into categories via
keyword rules, and each item's "summary" is a truncated excerpt of the
original RSS/abstract snippet (never the full article body, to respect
publisher copyright).

---

## How it works

- **Refresh** (the button in the UI, or `npm run fetch` from the CLI) fetches
  new items from all sources in parallel, deduplicates by normalized URL and
  fuzzy title match, drops anything already seen in a past digest, then
  categorizes/summarizes/scores what's left and keeps the top ~15–20 most
  substantive items for a new digest. If nothing new was found, no empty
  digest is created — the most recent one just stays current.
- **Categories**: every item gets exactly one of *Computational
  Neuroscience*, *Quantum Biology*, *Behavioral Neuroscience*, or *General
  Neuroscience & Psychobiology*.
- **Brain Fact of the Day**: picked from the seed bank (never-shown facts
  first, then least-recently-shown), rotated once per calendar day. If an
  API key is set, roughly once a week the app asks Claude for a handful of
  new candidate facts, runs them through a basic plausibility filter, and
  appends survivors to the bank — nothing generated is shown before that
  filter runs.
- **Archive**: every compiled digest is kept and browsable by date.
- **Settings**: toggle daily/weekly labeling and mute categories you don't
  want included in future digests (past digests are unaffected).

---

## Hands-off daily updates (optional)

The web app's "Refresh now" button is the simplest way to update the
digest — it always works, no scheduler required. If you'd rather have it
update automatically every morning, `npm run fetch` runs the exact same
fetch-and-compile pipeline outside the web server, so you can hook it into
your OS's own scheduler.

### Windows (Task Scheduler)

1. Open **Task Scheduler** → **Create Basic Task…**
2. Trigger: **Daily**, at whatever time you want (e.g. 7:00 AM).
3. Action: **Start a program**
   - Program/script: `npm.cmd` (or the full path to `npm.cmd`, typically
     found via `where npm` in a terminal)
   - Add arguments: `run fetch`
   - Start in: the full path to this project folder, e.g.
     `C:\Users\you\Learn\neuro-digest`
4. Finish. The task will run `npm run fetch` in this folder every day.

### macOS / Linux (cron)

```bash
crontab -e
```

Add a line like (adjust the path and time):

```
0 7 * * * cd /path/to/neuro-digest && /usr/local/bin/npm run fetch >> /tmp/neuro-digest.log 2>&1
```

---

## Project structure

```
src/
  db/            Drizzle schema, migrations, seed data (75+ brain facts)
  lib/
    fetchers/    PubMed, arXiv, bioRxiv, and RSS fetchers
    claude.ts    Anthropic API integration (categorize/summarize/brain facts)
    categorize.ts   Keyword-based fallback categorizer
    dedupe.ts    URL + fuzzy-title deduplication
    score.ts     Ranks items so only the most substantive ~15-20 surface
    pipeline.ts  Orchestrates the whole fetch -> digest flow
    digest.ts    Read-side queries used by the pages
  app/           Next.js App Router pages + API routes
  components/    UI components
scripts/fetch.ts Standalone fetch-and-compile script (for cron/Task Scheduler)
```

## Backing up your archive

The whole app is a single SQLite file at `./data/neuro-digest.db`. If you
reinstall or move machines and want to keep your digest archive and brain
fact history, just copy that file over.

## A note on the RSS feed URLs

The journalism feed URLs in `src/lib/fetchers/journalism.ts` were verified
to resolve at the time this project was generated. Publishers occasionally
change feed paths — if one starts 404ing, check the site's own `/rss` or
`/feed` listing page for the replacement and update the URL there.

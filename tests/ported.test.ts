// Features carried over from main and rebuilt on the shared-pool engine:
// engagement-based muting, half-price batch writing, citations, syllabus
// comparison, and the summary number guard. No AI or network calls.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbFile = path.join(os.tmpdir(), `neuron-ported-${process.pid}-${Date.now()}.db`);
process.env.NEURON_LOCAL_DB = "1";
process.env.NEURON_DB_FILE = dbFile;
delete process.env.BATCH_WRITES;

const batchState: { submitted: any[]; completed: any[] } = { submitted: [], completed: [] };

vi.mock("@/lib/ai", async (orig) => {
  const real = await orig<typeof import("@/lib/ai")>();
  return {
    ...real,
    hasClaudeKey: () => true,
    getAnthropicClient: () => null,
    getBatchClient: () => ({}) as any, // "a key is configured"
    generateJson: vi.fn(async (opts: { schema: any }) => {
      if (opts.schema.properties.bites) {
        return {
          concepts: [{ name: "Batch concept", definition: "Defined.", difficulty: 2, prerequisites: [] }],
          bites: [{ headline: "From a batch", text: "Written at half price.", kind: "idea", highlight: "half price", takeaway: "Batches are cheaper.", conceptIndex: 0 }],
          quiz: [],
          followUps: [],
          insight: { applicable: false, content: "" },
          myth: { applicable: false, myth: "", fact: "" },
          diagram: { applicable: false, mermaid: "", caption: "" },
        };
      }
      return { score: 5, unsupportedClaims: [], summary: "Fine." };
    }),
  };
});
vi.mock("@/lib/deepDive", () => ({
  generateDeepDive: vi.fn(async () => null),
  gatherDeepDiveMaterial: vi.fn(async () => ({ topic: "Batched topic", material: "notes", sources: [{ title: "Src", url: "https://example.org/a" }] })),
  buildDeepDiveWriteParams: vi.fn(() => ({ model: "m", max_tokens: 10, messages: [] })),
  parseDeepDiveWriteResult: (t: string) => t.trim(),
}));
vi.mock("@/lib/batch", () => ({
  submitBatch: vi.fn(async (opts: any) => {
    const { client } = await import("@/db");
    for (const r of opts.requests) {
      await client.execute({
        sql: "INSERT INTO batch_requests (content_type, payload, status) VALUES (?, ?, 'submitted')",
        args: [r.contentType, JSON.stringify(r.payload)],
      });
      batchState.submitted.push(r);
    }
    return 1;
  }),
  pollAndProcessBatches: vi.fn(async () => {
    const { client } = await import("@/db");
    await client.execute("UPDATE batch_requests SET status = 'succeeded'");
    const out = batchState.completed;
    batchState.completed = [];
    return out;
  }),
}));
vi.mock("@/lib/drills", () => ({ generateGroundedDrill: vi.fn(async () => null), generateStandaloneLogicDrill: vi.fn(async () => null) }));
vi.mock("@/lib/explainBack", () => ({ generateEssayPrompt: vi.fn(async () => null), generateExplainBackFeedback: vi.fn(async () => null) }));
vi.mock("@/lib/articleFetch", () => ({ fetchArticleText: vi.fn(async () => "text"), fetchArticleWithTitle: vi.fn(async () => null) }));

let db: typeof import("@/db");
let mutes: typeof import("@/lib/mutes");
let feed: typeof import("@/lib/feed");
let cards: typeof import("@/lib/engine/cards");
let userId: number;
let interestId: number;
const realFetch = globalThis.fetch;

const userObj = () => ({ id: userId, email: "", displayName: null, plan: "free" as const, role: "user" as const, prefs: {}, onboarded: true, createdAt: "" });

beforeAll(async () => {
  globalThis.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as any;
  db = await import("@/db");
  const { ensureDb } = await import("@/db/bootstrap");
  await ensureDb();
  mutes = await import("@/lib/mutes");
  feed = await import("@/lib/feed");
  cards = await import("@/lib/engine/cards");
  interestId = Number(((await db.client.execute("SELECT id FROM interests WHERE slug = 'economics'")).rows[0] as any).id);
  const u = await db.client.execute(
    "INSERT INTO users (email, password_hash, onboarded_at, last_active_at) VALUES ('m@example.test', 'x', current_timestamp, current_timestamp) RETURNING id"
  );
  userId = Number((u.rows[0] as any).id);
  await db.client.execute({ sql: "INSERT INTO user_interest_prefs (user_id, interest_id, level, enabled) VALUES (?, ?, 'some_background', 1)", args: [userId, interestId] });
});

afterAll(() => {
  globalThis.fetch = realFetch;
  db?.client.close();
  for (const s of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(dbFile + s, { force: true });
    } catch {}
  }
});

describe("engagement-based muting", () => {
  it("needs enough evidence before judging", () => {
    expect(mutes.shouldMute(mutes.engagementRate(5, 0))).toBe(false); // too few shown
    expect(mutes.shouldMute(mutes.engagementRate(10, 1))).toBe(true); // 10% engaged
    expect(mutes.shouldMute(mutes.engagementRate(10, 2))).toBe(false); // exactly 20% is not "below"
    expect(mutes.shouldMute(mutes.engagementRate(40, 30))).toBe(false);
  });

  it("mutes a card type the reader keeps skipping, hides it from the feed, and says so", async () => {
    const paperIds: number[] = [];
    for (let i = 0; i < 12; i++) {
      paperIds.push(await cards.upsertCard({ type: "paper", interestId, level: null, title: `Paper ${i}`, body: "Summary.", payload: { url: "https://example.org", sourceName: "X", badge: "journalism" }, dedupeKey: `mute-paper-${i}` }));
    }
    const fact = await cards.upsertCard({ type: "bite", interestId, level: "some_background", title: "A bite", body: "Text.", dedupeKey: "mute-bite-1" });
    // Ten papers swiped past in under a second each; two left unseen.
    for (const id of paperIds.slice(0, 10)) {
      await feed.recordEvents(userId, [{ cardId: id, event: "impression" }, { cardId: id, event: "dwell", value: 300 }]);
    }

    const flipped = await mutes.runMuteSweep(userId);
    expect(flipped).toEqual([{ interestId, cardType: "paper" }]);

    const page = await feed.getFeedPage({ ...userObj(), prefs: { lastMuteSweep: new Date().toISOString().slice(0, 10) } }, { count: 20 });
    expect(page.cards.some((c) => c.kind === "paper" && c.interestId === interestId)).toBe(false);
    expect(page.cards.some((c) => c.cardId === fact)).toBe(true); // other types still shown

    const notices = await mutes.getActiveMuteNotices(userId);
    expect(notices).toHaveLength(1);
    expect(notices[0].label).toBe("research summaries");
  });

  it("dismissing keeps it hidden; resuming brings it back with a clean slate", async () => {
    await mutes.dismissMuteNotice(userId, interestId, "paper");
    expect(await mutes.getActiveMuteNotices(userId)).toHaveLength(0);
    expect(await mutes.getAllMutes(userId)).toHaveLength(1);

    await mutes.resumeMuted(userId, interestId, "paper");
    expect(await mutes.getMutes(userId)).toHaveLength(0);
    // The old skips no longer count, so the next sweep doesn't mute it straight away again.
    expect(await mutes.runMuteSweep(userId)).toEqual([]);
    const page = await feed.getFeedPage({ ...userObj(), prefs: { lastMuteSweep: new Date().toISOString().slice(0, 10) } }, { count: 20 });
    expect(page.cards.some((c) => c.kind === "paper" && c.interestId === interestId)).toBe(true);
  });

  it("does not mute a type the reader engages with", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 10; i++) ids.push(await cards.upsertCard({ type: "insight", interestId, level: null, title: `Insight ${i}`, body: "Do this.", dedupeKey: `mute-insight-${i}` }));
    for (const id of ids) await feed.recordEvents(userId, [{ cardId: id, event: "dwell", value: 8000 }]);
    expect(await mutes.runMuteSweep(userId)).toEqual([]);
  });
});

describe("batch writing for unattended series entries", () => {
  it("submits the write as a batch instead of generating live when nobody is waiting", async () => {
    const jobs = await import("@/lib/engine/jobs");
    await db.client.execute("DELETE FROM jobs");
    const id = await jobs.enqueue("series_next", { interestId, level: "some_background" }); // no userId = scheduler-originated
    await jobs.runOne();
    expect((await jobs.getJob(id))?.result).toEqual({ batched: true, topic: "Batched topic" });
    expect(batchState.submitted).toHaveLength(1);
    expect(batchState.submitted[0].payload).toMatchObject({ interestId, level: "some_background", topic: "Batched topic" });
    const dives = await db.client.execute({ sql: "SELECT COUNT(*) AS n FROM deep_dives WHERE interest_id = ?", args: [interestId] });
    expect(Number((dives.rows[0] as any).n)).toBe(0); // nothing published yet
  });

  it("does not queue the same series again while its write is in flight", async () => {
    const { planWork } = await import("@/lib/engine/scheduler");
    const { hasPendingSeriesWrite } = await import("@/lib/engine/batchSeries");
    expect(await hasPendingSeriesWrite(interestId, "some_background")).toBe(true);
    await db.client.execute("DELETE FROM jobs");
    // AHEAD_TARGET is 3 and one is in flight, so the scheduler still wants more —
    // but a second submit for the same series must not create a second request.
    await planWork();
    const { submitSeriesWrite } = await import("@/lib/engine/batchSeries");
    await submitSeriesWrite(interestId, "some_background");
    expect(batchState.submitted).toHaveLength(1);
  });

  it("publishes the entry, with cards, once the batch has finished", async () => {
    const { collectSeriesWrites } = await import("@/lib/engine/batchSeries");
    batchState.completed = [
      { id: 1, purpose: "round-a", dailyCycleId: null, weeklyCycleId: null, results: [{ requestId: 1, contentType: "series_write", payload: batchState.submitted[0].payload, ok: true, text: "## Written in a batch\n\nBody." }] },
    ];
    expect(await collectSeriesWrites()).toBe(1);
    const dive = (await db.client.execute({ sql: "SELECT topic, seq, status, content FROM deep_dives WHERE interest_id = ?", args: [interestId] })).rows[0] as any;
    expect(dive).toMatchObject({ topic: "Batched topic", seq: 1, status: "published" });
    expect(dive.content).toContain("Written in a batch");
    const biteCount = await db.client.execute("SELECT COUNT(*) AS n FROM cards WHERE title = 'From a batch'");
    expect(Number((biteCount.rows[0] as any).n)).toBe(1);
  });

  it("skips a batch result whose topic was written in the meantime, and ignores failures", async () => {
    const { collectSeriesWrites } = await import("@/lib/engine/batchSeries");
    batchState.completed = [
      {
        id: 2, purpose: "round-a", dailyCycleId: null, weeklyCycleId: null,
        results: [
          { requestId: 2, contentType: "series_write", payload: { interestId, level: "some_background", topic: "batched TOPIC", sources: [] }, ok: true, text: "Duplicate." },
          { requestId: 3, contentType: "series_write", payload: { interestId, level: "some_background", topic: "Never arrived", sources: [] }, ok: false, text: null },
        ],
      },
    ];
    expect(await collectSeriesWrites()).toBe(0);
  });

  it("writes live when a person is waiting, or when batching is switched off", async () => {
    const { batchWritesEnabled } = await import("@/lib/engine/batchSeries");
    expect(batchWritesEnabled()).toBe(true);
    process.env.BATCH_WRITES = "0";
    expect(batchWritesEnabled()).toBe(false);
    delete process.env.BATCH_WRITES;
  });
});

describe("citations", () => {
  it("builds BibTeX and RIS without inventing missing fields", async () => {
    const c = await import("@/lib/citations");
    const entry = c.itemToCitationEntry({
      title: "Sleep and memory consolidation",
      authors: null,
      url: "https://doi.org/10.1000/xyz",
      sourceName: "PubMed",
      sourceType: "academic",
      publishedAt: "2025-03-01",
      citationMetadata: JSON.stringify({ authors: ["Walker, Matthew", "Stickgold R"], journal: "Nature", doi: "10.1000/xyz", year: "2025" }),
    });
    expect(entry.entryType).toBe("article");
    const key = c.citeKeyFor(entry);
    expect(key).toBe("Walker2025Sleep");
    const bib = c.toBibTeX(entry, key);
    expect(bib).toContain("@article{Walker2025Sleep,");
    expect(bib).toContain("journal = {Nature}");
    expect(c.toRIS(entry)).toContain("TY  - JOUR");

    // A plain news item: no journal, no DOI — and none made up.
    const news = c.itemToCitationEntry({ title: "A feature", authors: null, url: "https://example.org/f", sourceName: "Quanta", sourceType: "journalism", publishedAt: null, citationMetadata: "{}" });
    expect(news.entryType).toBe("misc");
    expect(news.year).toBeNull();
    expect(c.toBibTeX(news, c.citeKeyFor(news))).not.toMatch(/journal|doi|year/);
  });

  it("gives duplicate keys distinct suffixes in a bulk export", async () => {
    const c = await import("@/lib/citations");
    const e = c.itemToCitationEntry({ title: "Same title", authors: "A Smith", url: "u", sourceName: "S", sourceType: "journalism", publishedAt: "2024-01-01", citationMetadata: "{}" });
    const keys = [...c.bulkBibTeX([e, e, e]).matchAll(/@misc\{([^,]+),/g)].map((m) => m[1]);
    expect(new Set(keys).size).toBe(3);
  });

  it("limits 'this week' to research the reader was actually shown", async () => {
    const c = await import("@/lib/citations");
    const item = await db.client.execute({
      sql: `INSERT INTO items (title, summary, source_name, source_type, interest_id, url, dedupe_key) VALUES ('Shown paper', 's', 'PubMed', 'academic', ?, 'https://e.org/1', 'cite-1') RETURNING id`,
      args: [interestId],
    });
    await db.client.execute({ sql: `INSERT INTO items (title, summary, source_name, source_type, interest_id, url, dedupe_key) VALUES ('Unseen paper', 's', 'PubMed', 'academic', ?, 'https://e.org/2', 'cite-2')`, args: [interestId] });
    const cardId = await cards.upsertCard({ type: "paper", interestId, level: null, itemId: Number((item.rows[0] as any).id), title: "Shown paper", body: "s", dedupeKey: "cite-card-1" });
    await feed.recordEvents(userId, [{ cardId, event: "impression" }]);
    const titles = (await c.getWeekCitationEntries(userId)).map((e) => e.title);
    expect(titles).toContain("Shown paper");
    expect(titles).not.toContain("Unseen paper");
  });
});

describe("syllabus comparison", () => {
  it("flags topics off the syllabus and topics with an older assigned reading", async () => {
    const { computeSyllabusComparison } = await import("@/lib/syllabus");
    const ctx = [
      { topic: "Working memory models", reference: "Week 4: Baddeley (2000), Trends in Cognitive Sciences", referenceYear: 2000, courseName: "PSYC301" },
      { topic: "Attention and perception", reference: null, referenceYear: null, courseName: "PSYC301" },
    ];
    expect(computeSyllabusComparison("Anything", [])).toBeNull();
    expect(computeSyllabusComparison("Quantum tunnelling in enzymes", ctx)?.status).toBe("not_in_syllabus");
    const newer = computeSyllabusComparison("Models of working memory", ctx);
    expect(newer?.status).toBe("newer_than_assigned");
    expect(newer?.referenceYear).toBe(2000);
    expect(computeSyllabusComparison("Attention and perception", ctx)).toBeNull(); // on the syllabus, nothing to claim
  });

  it("keeps one person's syllabus out of another's view", async () => {
    const { getSyllabusContext } = await import("@/lib/syllabus");
    const ins = await db.client.execute({ sql: "INSERT INTO syllabi (user_id, interest_id, name, raw_content) VALUES (?, ?, 'ECON101', 'raw') RETURNING id", args: [userId, interestId] });
    await db.client.execute({ sql: "INSERT INTO syllabus_topics (syllabus_id, topic) VALUES (?, 'Supply and demand')", args: [Number((ins.rows[0] as any).id)] });
    expect(await getSyllabusContext(userId, interestId)).toHaveLength(1);
    expect(await getSyllabusContext(userId + 999, interestId)).toHaveLength(0);
  });
});

describe("summary number guard", () => {
  it("reports numbers in a summary that are not in the source", async () => {
    const { inventedNumbers } = await import("@/lib/summaryLlm");
    const source = "In a sample of 1,204 adults, recall improved by 23% after 8 weeks.";
    expect(inventedNumbers("Among 1204 adults, recall rose 23% over 8 weeks.", source)).toEqual([]);
    expect(inventedNumbers("Recall rose 47% in 1,204 adults.", source)).toEqual(["47"]);
  });
});

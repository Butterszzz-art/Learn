// The content engine end to end — queue → write a deep dive → source check →
// expand into cards and concepts → feed — with the AI calls replaced by
// canned responses, so the plumbing is verified without spending anything.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbFile = path.join(os.tmpdir(), `neuron-engine-${process.pid}-${Date.now()}.db`);
process.env.NEURON_LOCAL_DB = "1";
process.env.NEURON_DB_FILE = dbFile;

const state = { reviewScore: 5, diveCount: 0, expandCalls: 0 };

const EXPANSION = {
  concepts: [
    { name: "Action potential", definition: "A brief electrical spike that travels along a neuron.", difficulty: 1, prerequisites: [] },
    { name: "Synaptic transmission", definition: "Passing a signal across the gap between neurons.", difficulty: 2, prerequisites: ["Action potential"] },
  ],
  bites: [
    { headline: "Neurons fire all-or-nothing", text: "A neuron either fires fully or not at all once it crosses about -55 mV.", kind: "hook", highlight: "-55 mV", takeaway: "Firing is binary; frequency carries the message.", conceptIndex: 0 },
    { headline: "The gap between neurons", text: "Signals cross a 20 nanometre cleft using chemical messengers.", kind: "idea", highlight: "not in the text", takeaway: "Chemistry bridges the gap.", conceptIndex: 1 },
    { headline: "Why speed varies", text: "Myelin lets signals jump between gaps, reaching 120 metres per second.", kind: "number", highlight: "120 metres per second", takeaway: "Insulation buys speed.", conceptIndex: 0 },
  ],
  quiz: [
    { question: "What does all-or-nothing mean?", options: ["It fires fully or not at all", "b", "c", "d"], correctIndex: 0, explanation: "Threshold decides.", conceptIndex: 0 },
    { question: "Broken question", options: ["only", "three", "options"], correctIndex: 0, explanation: "", conceptIndex: 1 },
  ],
  followUps: [{ topic: "How myelin forms", teaser: "Next: the cells that wrap axons." }, { topic: "Neurotransmitter types", teaser: "Next: the chemical vocabulary." }],
  insight: { applicable: true, content: "Sleep protects the myelin you build while practising a skill." },
  myth: { applicable: true, myth: "We only use 10% of our brains.", fact: "Imaging shows activity across the whole brain over a day." },
  diagram: { applicable: true, mermaid: 'flowchart LR\n  A["Stimulus"] --> B["Threshold reached"]\n  B --> C["Action potential"]', caption: "From stimulus to spike." },
};

vi.mock("@/lib/ai", async (orig) => {
  const real = await orig<typeof import("@/lib/ai")>();
  return {
    ...real,
    hasClaudeKey: () => true,
    getAnthropicClient: () => null,
    generateJson: vi.fn(async (opts: { schema: any }) => {
      if (opts.schema.properties.bites) {
        state.expandCalls++;
        return EXPANSION;
      }
      if (opts.schema.properties.unsupportedClaims) {
        return { score: state.reviewScore, unsupportedClaims: state.reviewScore < 3 ? ["An invented statistic"] : [], summary: "Reviewed." };
      }
      return null;
    }),
  };
});
vi.mock("@/lib/deepDive", () => ({
  generateDeepDive: vi.fn(async (_name: string, _level: string, covered: { totalCount: number }, forced?: string) => {
    state.diveCount++;
    return {
      topic: forced ?? `Series entry ${covered.totalCount + 1}`,
      content: "## How neurons signal\n\nBody of the entry.",
      sources: [{ title: "A textbook chapter", url: "https://example.org/neurons" }],
    };
  }),
}));
vi.mock("@/lib/drills", () => ({ generateGroundedDrill: vi.fn(async () => null), generateStandaloneLogicDrill: vi.fn(async () => null) }));
vi.mock("@/lib/explainBack", () => ({ generateEssayPrompt: vi.fn(async () => null), generateExplainBackFeedback: vi.fn(async () => null) }));
vi.mock("@/lib/articleFetch", () => ({ fetchArticleText: vi.fn(async () => "Source text about neurons."), fetchArticleWithTitle: vi.fn(async () => null) }));

let db: typeof import("@/db");
let jobs: typeof import("@/lib/engine/jobs");
let scheduler: typeof import("@/lib/engine/scheduler");
let feed: typeof import("@/lib/feed");
let content: typeof import("@/lib/content");
let neuroId: number;
let userId: number;
const realFetch = globalThis.fetch;

async function count(sql: string, args: (string | number)[] = []): Promise<number> {
  const res = await db.client.execute({ sql, args });
  return Number((res.rows[0] as any).n);
}

beforeAll(async () => {
  // Source links "load" fine unless a test says otherwise.
  globalThis.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as any;
  db = await import("@/db");
  const { ensureDb } = await import("@/db/bootstrap");
  await ensureDb();
  jobs = await import("@/lib/engine/jobs");
  scheduler = await import("@/lib/engine/scheduler");
  feed = await import("@/lib/feed");
  content = await import("@/lib/content");

  const res = await db.client.execute("SELECT id FROM interests WHERE slug = 'neuroscience'");
  neuroId = Number((res.rows[0] as any).id);
  const u = await db.client.execute(
    "INSERT INTO users (email, password_hash, onboarded_at, last_active_at) VALUES ('reader@example.test', 'x', current_timestamp, current_timestamp) RETURNING id"
  );
  userId = Number((u.rows[0] as any).id);
  await db.client.execute({ sql: "INSERT INTO user_interest_prefs (user_id, interest_id, level, enabled) VALUES (?, ?, 'new_to_this', 1)", args: [userId, neuroId] });
});

afterAll(() => {
  globalThis.fetch = realFetch;
  db?.client.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(dbFile + suffix, { force: true });
    } catch {}
  }
});

describe("scheduler", () => {
  it("queues one series entry per followed (interest, level), however many times it is asked", async () => {
    const first = await scheduler.planWork(userId);
    expect(first.series).toBe(1);
    await scheduler.planWork(userId);
    await scheduler.planWork();
    expect(await count("SELECT COUNT(*) AS n FROM jobs WHERE type = 'series_next' AND status = 'queued'")).toBe(1);
  });
});

describe("writing and expanding a deep dive", () => {
  it("runs the queued job and publishes cards, concepts and prerequisite links", async () => {
    // Only the series job matters here; drop the news job so no feeds are fetched.
    await db.client.execute("DELETE FROM jobs WHERE type != 'series_next'");
    expect(await jobs.runOne()).toBe(true);

    const dive = (await db.client.execute("SELECT * FROM deep_dives")).rows[0] as any;
    expect(dive.status).toBe("published");
    expect(dive.seq).toBe(1);
    expect(dive.level).toBe("new_to_this");
    expect(dive.quality_score).toBe(5);
    expect(dive.expanded_at).not.toBeNull();

    const byType = await db.client.execute({ sql: "SELECT type, COUNT(*) AS n FROM cards WHERE deep_dive_id = ? GROUP BY type", args: [dive.id] });
    const counts = Object.fromEntries((byType.rows as any[]).map((r) => [r.type, Number(r.n)]));
    // 3 bites, 1 diagram, 1 myth, 1 valid quiz (the 3-option one is dropped), 1 insight.
    expect(counts).toEqual({ bite: 3, visual: 1, myth: 1, quiz: 1, insight: 1 });

    expect(await count("SELECT COUNT(*) AS n FROM concepts WHERE interest_id = ?", [neuroId])).toBe(2);
    const edge = await db.client.execute(
      `SELECT f.name AS pre, t.name AS post FROM concept_edges e
       JOIN concepts f ON f.id = e.from_concept_id JOIN concepts t ON t.id = e.to_concept_id`
    );
    expect(edge.rows).toEqual([{ pre: "Action potential", post: "Synaptic transmission" }]);
  });

  it("drops a highlight that doesn't appear in the text rather than showing a wrong one", async () => {
    const res = await db.client.execute("SELECT title, payload FROM cards WHERE type = 'bite' ORDER BY seq");
    const payloads = (res.rows as any[]).map((r) => JSON.parse(r.payload));
    expect(payloads[0].highlight).toBe("-55 mV");
    expect(payloads[1].highlight).toBeUndefined();
  });

  it("marks the job done and records the result for the waiting client", async () => {
    const job = (await db.client.execute("SELECT id FROM jobs WHERE type = 'series_next'")).rows[0] as any;
    const info = await jobs.getJob(Number(job.id));
    expect(info?.status).toBe("done");
    expect(info?.result.deepDiveId).toBeGreaterThan(0);
    expect(info?.result.flagged).toBe(false);
  });

  it("is idempotent: expanding again adds nothing", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM cards WHERE deep_dive_id IS NOT NULL");
    const dive = (await db.client.execute("SELECT id FROM deep_dives")).rows[0] as any;
    await db.client.execute({ sql: "UPDATE deep_dives SET expanded_at = NULL WHERE id = ?", args: [dive.id] });
    const { expandExistingDeepDive } = await import("@/lib/engine/series");
    await expandExistingDeepDive(Number(dive.id));
    expect(await count("SELECT COUNT(*) AS n FROM cards WHERE deep_dive_id IS NOT NULL")).toBe(before);
  });

  it("serves the new cards to the reader, in order, and exposes the layers on the detail view", async () => {
    const user = { id: userId, email: "", displayName: null, plan: "free" as const, role: "user" as const, prefs: {}, onboarded: true, createdAt: "" };
    const page = await feed.getFeedPage(user, { count: 20 });
    const dive = (await db.client.execute("SELECT id FROM deep_dives")).rows[0] as any;
    const mine = page.cards.filter((c) => c.deepDiveId === Number(dive.id));
    expect(mine.slice(0, 3).map((c) => c.title)).toEqual(["Neurons fire all-or-nothing", "The gap between neurons", "Why speed varies"]);
    expect(mine.findIndex((c) => c.kind === "quiz")).toBeGreaterThan(0);
    expect(mine[0].conceptName).toBe("Action potential");

    const detail = await content.getDeepDiveDetail(Number(dive.id), userId);
    expect(detail?.takeaways.length).toBe(3);
    expect(detail?.followUpTopics.map((f) => f.topic)).toEqual(["How myelin forms", "Neurotransmitter types"]);
    expect(detail?.appliedInsight).toMatch(/myelin/);
    expect(detail?.quizCards.length).toBe(1);
    expect(detail?.concepts.length).toBe(2);
  });
});

describe("quality gate", () => {
  it("holds back an entry the review scores low, and hides its cards", async () => {
    state.reviewScore = 2;
    const { generateNextInSeries } = await import("@/lib/engine/series");
    const result = await generateNextInSeries(neuroId, "new_to_this");
    expect(result?.flagged).toBe(true);
    const dive = (await db.client.execute({ sql: "SELECT status, quality_notes FROM deep_dives WHERE id = ?", args: [result!.deepDiveId] })).rows[0] as any;
    expect(dive.status).toBe("flagged");
    expect(dive.quality_notes).toMatch(/invented statistic/i);
    expect(await count("SELECT COUNT(*) AS n FROM cards WHERE deep_dive_id = ? AND status = 'published'", [result!.deepDiveId])).toBe(0);
    state.reviewScore = 5;
  });

  it("holds back an entry whose every source link is dead", async () => {
    (globalThis.fetch as any).mockImplementation(async () => new Response("gone", { status: 404 }));
    const { checkDeepDiveQuality } = await import("@/lib/engine/quality");
    const q = await checkDeepDiveQuality("Topic", "Body", [{ title: "Dead", url: "https://example.org/dead" }]);
    expect(q.flagged).toBe(true);
    expect(q.score).toBe(1);
    (globalThis.fetch as any).mockImplementation(async () => new Response("ok", { status: 200 }));
  });

  it("holds back an entry with no sources at all", async () => {
    const { checkDeepDiveQuality } = await import("@/lib/engine/quality");
    expect((await checkDeepDiveQuality("Topic", "Body", [])).flagged).toBe(true);
  });
});

describe("on-demand topics", () => {
  it("writes a requested topic once and reuses it for the next person", async () => {
    const { findOrGenerateTopicDive } = await import("@/lib/engine/series");
    const before = state.diveCount;
    const first = await findOrGenerateTopicDive(neuroId, "new_to_this", "How myelin forms");
    const second = await findOrGenerateTopicDive(neuroId, "new_to_this", "how MYELIN forms ");
    expect(second?.deepDiveId).toBe(first?.deepDiveId);
    expect(state.diveCount).toBe(before + 1);
    // A follow-up entry sits outside the numbered series.
    const row = (await db.client.execute({ sql: "SELECT seq, origin FROM deep_dives WHERE id = ?", args: [first!.deepDiveId] })).rows[0] as any;
    expect(row.origin).toBe("followup");
    expect(row.seq).toBeNull();
  });
});

describe("job failures", () => {
  it("retries a failing job, then marks it failed and logs it", async () => {
    const { generateDeepDive } = await import("@/lib/deepDive");
    (generateDeepDive as any).mockImplementation(async () => null);
    const id = await jobs.enqueue("series_next", { interestId: neuroId, level: "advanced" });
    for (let i = 0; i < 3; i++) {
      await db.client.execute({ sql: "UPDATE jobs SET run_after = NULL WHERE id = ?", args: [id] });
      await jobs.runOne();
    }
    expect((await jobs.getJob(id))?.status).toBe("failed");
    expect(await count("SELECT COUNT(*) AS n FROM error_log WHERE source = 'job'")).toBe(3);
    expect(await jobs.runOne()).toBe(false); // nothing left that is allowed to run
  });
});

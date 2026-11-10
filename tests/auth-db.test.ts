// Integration tests against a real, throwaway SQLite file: the migration,
// account isolation, feed building, event recording and the review loop.
// No AI calls are made — content is inserted directly.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbFile = path.join(os.tmpdir(), `neuron-test-${process.pid}-${Date.now()}.db`);
process.env.NEURON_LOCAL_DB = "1";
process.env.NEURON_DB_FILE = dbFile;
delete process.env.ANTHROPIC_API_KEY;

// next/headers isn't available outside a request; auth only needs the cookie jar.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  }),
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

type Mods = {
  auth: typeof import("@/lib/auth");
  interests: typeof import("@/lib/interests");
  feed: typeof import("@/lib/feed");
  cards: typeof import("@/lib/engine/cards");
  learning: typeof import("@/lib/learning");
  content: typeof import("@/lib/content");
  search: typeof import("@/lib/searchIndex");
  plan: typeof import("@/lib/plan");
  jobs: typeof import("@/lib/engine/jobs");
  db: typeof import("@/db");
};
let m: Mods;
let alice: number;
let bob: number;
let neuroId: number;
let diveId: number;

async function userObj(id: number) {
  const res = await m.db.client.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] });
  const r = res.rows[0] as any;
  return { id, email: r.email, displayName: null, plan: r.plan, role: r.role, prefs: JSON.parse(r.prefs), onboarded: true, createdAt: r.created_at };
}

beforeAll(async () => {
  m = {
    auth: await import("@/lib/auth"),
    interests: await import("@/lib/interests"),
    feed: await import("@/lib/feed"),
    cards: await import("@/lib/engine/cards"),
    learning: await import("@/lib/learning"),
    content: await import("@/lib/content"),
    search: await import("@/lib/searchIndex"),
    plan: await import("@/lib/plan"),
    jobs: await import("@/lib/engine/jobs"),
    db: await import("@/db"),
  };
  const { ensureDb } = await import("@/db/bootstrap");
  await ensureDb();

  const a = await m.auth.signUp("alice@example.test", "correct horse battery", "1.1.1.1");
  const b = await m.auth.signUp("bob@example.test", "another long password", "2.2.2.2");
  if (!a.ok || !b.ok) throw new Error("signup failed");
  alice = a.userId;
  bob = b.userId;

  neuroId = (await m.interests.getInterestRowBySlug("neuroscience"))!.id;
  const inserted = await m.db.client.execute({
    sql: `INSERT INTO deep_dives (interest_id, topic, content, sources, level, seq, origin, status)
          VALUES (?, 'Synaptic plasticity', 'Body text.', '[]', 'some_background', 1, 'syllabus', 'published') RETURNING id`,
    args: [neuroId],
  });
  diveId = Number((inserted.rows[0] as any).id);
  const conceptId = await m.cards.upsertConcept({ interestId: neuroId, name: "Long-term potentiation", definition: "A lasting strengthening of a synapse.", difficulty: 2, deepDiveId: diveId });
  const base = { interestId: neuroId, level: "some_background" as const, deepDiveId: diveId, conceptId };
  await m.cards.upsertCard({ ...base, type: "bite", seq: 0, title: "Synapses change with use", body: "Text.", dedupeKey: `t:${diveId}:0` });
  await m.cards.upsertCard({ ...base, type: "bite", seq: 1, title: "Why timing matters", body: "Text.", dedupeKey: `t:${diveId}:1` });
  await m.cards.upsertCard({
    ...base, type: "quiz", seq: 2, title: "Synaptic plasticity", body: "What is LTP?",
    payload: { options: ["a", "b", "c", "d"], correctIndex: 0, explanation: "Because.", kind: "selfcheck" }, dedupeKey: `t:${diveId}:q`,
  });
});

afterAll(() => {
  m?.db.client.close();
  // Windows can hold the file open a moment longer; a leftover temp file is harmless.
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(dbFile + suffix, { force: true });
    } catch {}
  }
});

describe("accounts", () => {
  it("makes the first account the owner and later ones ordinary", async () => {
    expect((await userObj(alice)).role).toBe("admin");
    expect((await userObj(bob)).role).toBe("user");
    expect((await userObj(bob)).plan).toBe("free");
  });

  it("stores password hashes, not passwords, and verifies them", async () => {
    const res = await m.db.client.execute({ sql: "SELECT password_hash FROM users WHERE id = ?", args: [alice] });
    const hash = (res.rows[0] as any).password_hash as string;
    expect(hash).not.toContain("correct horse");
    expect(await m.auth.verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await m.auth.verifyPassword("wrong", hash)).toBe(false);
  });

  it("rejects bad input and duplicate emails, and gives one message for bad logins", async () => {
    expect((await m.auth.signUp("not-an-email", "longenough1", "3.3.3.3")).ok).toBe(false);
    expect((await m.auth.signUp("carol@example.test", "short", "3.3.3.3")).ok).toBe(false);
    expect((await m.auth.signUp("ALICE@example.test", "correct horse battery", "3.3.3.3")).ok).toBe(false);
    const wrongPw = await m.auth.signIn("alice@example.test", "nope nope nope", "4.4.4.4");
    const noUser = await m.auth.signIn("nobody@example.test", "nope nope nope", "4.4.4.4");
    expect(wrongPw.ok).toBe(false);
    expect(!wrongPw.ok && !noUser.ok && wrongPw.error === noUser.error).toBe(true);
  });

  it("locks out repeated failed logins", async () => {
    let last: Awaited<ReturnType<typeof m.auth.signIn>> | null = null;
    for (let i = 0; i < 10; i++) last = await m.auth.signIn("bob@example.test", "wrong password", "9.9.9.9");
    expect(last && !last.ok && /too many/i.test(last.error)).toBe(true);
  });

  it("resolves the session cookie to the right user", async () => {
    await m.auth.signIn("bob@example.test", "another long password", "5.5.5.5");
    expect((await m.auth.getCurrentUser())?.id).toBe(bob);
    await m.auth.signOut();
    expect(await m.auth.getCurrentUser()).toBeNull();
  });
});

describe("per-user isolation", () => {
  it("keeps interest choices separate", async () => {
    await m.interests.setUserInterest(alice, neuroId, "some_background", true);
    expect((await m.interests.getEnabledInterests(alice)).map((i) => i.id)).toEqual([neuroId]);
    expect(await m.interests.getEnabledInterests(bob)).toEqual([]);
  });

  it("shares one row for a custom interest two people type", async () => {
    const a = await m.interests.createCustomInterest(alice, "Volcanology");
    const b = await m.interests.createCustomInterest(bob, "  volcanology ");
    expect(a.id).toBe(b.id);
    // …but it is only listed for people who follow it.
    await m.interests.setUserInterest(alice, a.id, "new_to_this", true);
    expect((await m.interests.getCatalog(alice)).some((i) => i.id === a.id)).toBe(true);
    expect((await m.interests.getCatalog(bob)).some((i) => i.id === a.id)).toBe(false);
    await m.interests.setUserInterest(alice, a.id, "new_to_this", false);
  });

  it("only returns private search results to their owner", async () => {
    await m.search.indexForSearch({ contentType: "chapter", sourceId: 9001, title: "Zebrafish regeneration notes", body: "private", interestLabel: "Library", interestId: null, date: "2026-11-10", url: "/x", userId: alice });
    await m.search.indexForSearch({ contentType: "deep_dive", sourceId: 9002, title: "Zebrafish as a model organism", body: "shared", interestLabel: "Biology", interestId: null, date: "2026-11-10", url: "/y", userId: null });
    expect((await m.search.searchIndex("zebrafish", alice)).length).toBe(2);
    const bobSees = await m.search.searchIndex("zebrafish", bob);
    expect(bobSees.map((r) => r.sourceId)).toEqual([9002]);
  });
});

describe("feed", () => {
  it("serves a series in order and holds the quiz until a teaching card was shown", async () => {
    const page = await m.feed.getFeedPage(await userObj(alice), { count: 10 });
    const fromDive = page.cards.filter((c) => c.deepDiveId === diveId);
    expect(fromDive.map((c) => c.kind)).toEqual(["bite", "bite", "quiz"]);
    expect(fromDive[0].title).toBe("Synapses change with use");
    expect(page.cards.every((c) => c.cardId === null || new Set(page.cards.map((x) => x.key)).size === page.cards.length)).toBe(true);
  });

  it("does not show a card again once it has been seen", async () => {
    const user = await userObj(alice);
    const first = await m.feed.getFeedPage(user, { count: 10 });
    const bite = first.cards.find((c) => c.kind === "bite" && c.deepDiveId === diveId)!;
    await m.feed.recordEvents(alice, [{ cardId: bite.cardId!, event: "impression" }, { cardId: bite.cardId!, event: "dwell", value: 6000 }]);
    const second = await m.feed.getFeedPage(user, { count: 10 });
    expect(second.cards.some((c) => c.cardId === bite.cardId)).toBe(false);
    // Bob never saw it, so it's still in his pool once he follows the interest.
    await m.interests.setUserInterest(bob, neuroId, "some_background", true);
    const bobPage = await m.feed.getFeedPage(await userObj(bob), { count: 10 });
    expect(bobPage.cards.some((c) => c.cardId === bite.cardId)).toBe(true);
  });

  it("respects the client's exclude list", async () => {
    const user = await userObj(bob);
    const first = await m.feed.getFeedPage(user, { count: 5 });
    const ids = first.cards.map((c) => c.cardId).filter((x): x is number => x !== null);
    const second = await m.feed.getFeedPage(user, { count: 5, exclude: ids });
    expect(second.cards.some((c) => c.cardId !== null && ids.includes(c.cardId))).toBe(false);
  });

  it("marks a concept as met after reading, and schedules it after a quiz answer", async () => {
    const before = await m.learning.getKnowledgeMap(alice, [neuroId]);
    const ltp = before[0].concepts.find((c) => c.name === "Long-term potentiation")!;
    expect(ltp.mastery).toBe("seen"); // from the dwell event above

    const quiz = await m.db.client.execute({ sql: "SELECT id FROM cards WHERE dedupe_key = ?", args: [`t:${diveId}:q`] });
    await m.feed.recordEvents(alice, [{ cardId: Number((quiz.rows[0] as any).id), event: "quiz_correct" }]);
    const after = await m.learning.getKnowledgeMap(alice, [neuroId]);
    const graded = after[0].concepts.find((c) => c.name === "Long-term potentiation")!;
    expect(graded.mastery).toBe("learning");
    expect(new Date(graded.due!).getTime()).toBeGreaterThan(Date.now());
    // Bob's map is untouched by Alice's answers.
    const bobMap = await m.learning.getKnowledgeMap(bob, [neuroId]);
    expect(bobMap[0].concepts.find((c) => c.name === "Long-term potentiation")!.mastery).toBe("unseen");
  });

  it("surfaces a due concept as a review card", async () => {
    await m.db.client.execute({ sql: "UPDATE user_concepts SET due = ? WHERE user_id = ?", args: [new Date(Date.now() - 1000).toISOString(), alice] });
    expect(await m.learning.countDue(alice)).toBe(1);
    const reviews = await m.feed.buildReviewCards(alice, 5, new Set());
    expect(reviews[0].kind).toBe("review");
    expect(reviews[0].payload.quiz.question).toBe("What is LTP?");
  });

  it("ignores events for cards that don't exist", async () => {
    await expect(m.feed.recordEvents(alice, [{ cardId: 99999999, event: "saved" }])).resolves.toBeUndefined();
  });
});

describe("limits and jobs", () => {
  it("caps free on-demand deep dives per day and deduplicates identical requests", async () => {
    const payload = { interestId: neuroId, level: "some_background" as const, topic: "Dendritic spines" };
    const first = await m.jobs.enqueue("topic_dive", payload, { userId: bob });
    const again = await m.jobs.enqueue("topic_dive", { ...payload, topic: "dendritic SPINES" }, { userId: alice });
    expect(again).toBe(first);
    expect((await m.plan.checkQuota(bob, "free", "onDemandDive")).ok).toBe(true);
    await m.jobs.enqueue("topic_dive", { ...payload, topic: "Glial cells" }, { userId: bob });
    const quota = await m.plan.checkQuota(bob, "free", "onDemandDive");
    expect(quota.ok).toBe(false);
    expect(quota.message).toMatch(/Pro/);
    expect((await m.plan.checkQuota(bob, "pro", "onDemandDive")).ok).toBe(true);
  });
});

describe("account deletion", () => {
  it("removes everything private and leaves shared content", async () => {
    await m.auth.deleteAccount(bob);
    for (const table of ["user_interest_prefs", "user_cards", "user_concepts", "sessions"]) {
      const res = await m.db.client.execute({ sql: `SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, args: [bob] });
      expect(Number((res.rows[0] as any).n)).toBe(0);
    }
    const gone = await m.db.client.execute({ sql: "SELECT COUNT(*) AS n FROM users WHERE id = ?", args: [bob] });
    expect(Number((gone.rows[0] as any).n)).toBe(0);
    const shared = await m.db.client.execute({ sql: "SELECT COUNT(*) AS n FROM cards WHERE deep_dive_id = ?", args: [diveId] });
    expect(Number((shared.rows[0] as any).n)).toBe(3);
    // Alice is unaffected.
    expect((await m.interests.getEnabledInterests(alice)).length).toBe(1);
  });
});

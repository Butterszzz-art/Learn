// Inserts a small set of hand-written demo content (two short entries with
// bites, concepts, a quiz, a diagram and a myth) so the app can be worked on
// locally without an API key. Local database only — it refuses to run
// against a hosted one. Safe to re-run.
//
//   npm run seed:demo
import { config } from "dotenv";
config({ path: ".env.local" });
process.env.NEURON_LOCAL_DB = "1";

interface DemoDive {
  slug: string;
  topic: string;
  content: string;
  sources: { title: string; url: string }[];
  concepts: { name: string; definition: string; difficulty: number; prereq?: string }[];
  bites: { headline: string; text: string; highlight?: string; takeaway: string; concept: number; kind: "hook" | "idea" | "number" | "why" }[];
  quiz: { question: string; options: string[]; correctIndex: number; explanation: string; concept: number }[];
  myth?: { myth: string; fact: string };
  diagram?: { mermaid: string; caption: string };
  insight?: string;
  followUps: { topic: string; teaser: string }[];
}

const DEMO: DemoDive[] = [
  {
    slug: "neuroscience",
    topic: "How neurons send signals",
    content:
      "## The all-or-nothing spike\n\nA neuron at rest holds a voltage of about -70 millivolts across its membrane. When incoming signals push that voltage past a threshold near -55 millivolts, voltage-gated sodium channels open and the cell fires an **action potential**: a brief, self-propagating reversal of voltage that travels down the axon.\n\nThe spike is *all-or-nothing*. A stronger stimulus does not make a bigger spike; it makes the neuron fire more often. Information is carried in the rate and timing of spikes, not their size.\n\n## Crossing the gap\n\nNeurons do not touch. At the **synapse**, the arriving spike opens calcium channels, and calcium triggers the release of neurotransmitter molecules into a cleft roughly 20 nanometres wide. Those molecules bind receptors on the next cell and nudge its voltage up or down.\n\n## Why insulation matters\n\nMany axons are wrapped in **myelin**, a fatty sheath made by glial cells. Myelin lets the signal jump between gaps in the sheath, raising conduction speed from around 1 metre per second to as much as 120.\n\n*This is demo content for local development.*",
    sources: [
      { title: "Neuroscience (open textbook) — the action potential", url: "https://openstax.org/books/anatomy-and-physiology-2e/pages/12-4-the-action-potential" },
    ],
    concepts: [
      { name: "Action potential", definition: "A brief, all-or-nothing reversal of voltage that travels along a neuron's axon.", difficulty: 1 },
      { name: "Synaptic transmission", definition: "Passing a signal from one neuron to the next by releasing neurotransmitter across the synaptic cleft.", difficulty: 2, prereq: "Action potential" },
      { name: "Myelination", definition: "Insulation of an axon by glial cells, which speeds up signal conduction.", difficulty: 2, prereq: "Action potential" },
    ],
    bites: [
      { kind: "hook", headline: "Neurons don't have a volume knob", text: "A neuron either fires completely or not at all. Push it harder and the spike doesn't get bigger — it just fires more often. Your brain encodes intensity in rhythm, not loudness.", highlight: "fires more often", takeaway: "Spike rate, not spike size, carries the message.", concept: 0 },
      { kind: "number", headline: "The threshold is about -55 millivolts", text: "A resting neuron sits near -70 millivolts. Nudge it past roughly -55 millivolts and sodium channels snap open, setting off a spike that runs the length of the axon.", highlight: "-55 millivolts", takeaway: "Cross the threshold and the spike is automatic.", concept: 0 },
      { kind: "idea", headline: "Neurons never actually touch", text: "Between two neurons is a gap about 20 nanometres wide. The signal crosses it chemically: calcium floods in, neurotransmitter is released, and receptors on the far side respond.", highlight: "20 nanometres", takeaway: "Electrical inside the cell, chemical between cells.", concept: 1 },
      { kind: "why", headline: "Insulation makes thought fast", text: "Wrapped in myelin, an axon can carry signals at up to 120 metres per second instead of about 1. Diseases that strip myelin, like multiple sclerosis, slow or block those signals.", highlight: "120 metres per second", takeaway: "Myelin is why a reflex beats a thought.", concept: 2 },
    ],
    quiz: [
      { question: "A stronger stimulus makes a neuron…", options: ["fire a larger spike", "fire more often", "fire more slowly", "release less neurotransmitter"], correctIndex: 1, explanation: "Action potentials are all-or-nothing, so intensity is coded by firing rate.", concept: 0 },
      { question: "How does a signal cross the synaptic cleft?", options: ["The spike jumps the gap electrically", "The cells fuse briefly", "Neurotransmitter is released and binds receptors", "Myelin carries it across"], correctIndex: 2, explanation: "At chemical synapses the signal is carried by neurotransmitter molecules.", concept: 1 },
    ],
    myth: { myth: "We only use 10% of our brains.", fact: "Brain imaging shows activity throughout the whole brain over the course of a day, and damage to almost any region has consequences." },
    diagram: { mermaid: 'flowchart TD\n  A["Voltage passes threshold"] --> B["Sodium channels open"]\n  B --> C["Action potential travels down axon"]\n  C --> D["Calcium enters the terminal"]\n  D --> E["Neurotransmitter released"]\n  E --> F["Next neuron\'s voltage changes"]', caption: "From threshold to the next neuron: the chain of events in one signal." },
    insight: "Skills you practise are thought to strengthen and insulate the pathways they use — and much of that consolidation happens during sleep. Short, regular practice followed by a full night's sleep beats one long cram.",
    followUps: [
      { topic: "How synapses strengthen with use", teaser: "Next: the cellular basis of learning." },
      { topic: "What glial cells actually do", teaser: "Next: the brain's other half." },
    ],
  },
  {
    slug: "psychology",
    topic: "Why testing yourself beats rereading",
    content:
      "## The testing effect\n\nTrying to recall something strengthens the memory more than reading it again. In a widely cited 2006 experiment by Roediger and Karpicke, students who read a passage once and were then tested recalled more a week later than students who read it several times — even though the rereaders felt more confident.\n\n## Why it works\n\nRetrieval is not a neutral read-out. Each successful recall changes the memory, making it easier to reach next time, and failed attempts show you exactly what you don't know.\n\n## Spacing\n\nRetrieval works best when it is **spaced**: revisiting an idea just as it starts to fade produces more durable memories than repeating it immediately.\n\n*This is demo content for local development.*",
    sources: [{ title: "Roediger & Karpicke (2006), Test-Enhanced Learning", url: "https://doi.org/10.1111/j.1467-9280.2006.01693.x" }],
    concepts: [
      { name: "Testing effect", definition: "Recalling information strengthens memory more than restudying it.", difficulty: 1 },
      { name: "Spacing effect", definition: "Reviews spread out over time produce more durable memory than massed repetition.", difficulty: 2, prereq: "Testing effect" },
    ],
    bites: [
      { kind: "hook", headline: "Rereading feels productive. It mostly isn't.", text: "Students who reread a passage felt more confident than students who were tested on it — and then remembered less a week later. Fluency is not the same as learning.", highlight: "remembered less", takeaway: "Feeling like you know it is a poor guide to knowing it.", concept: 0 },
      { kind: "idea", headline: "Remembering is an act, not a read-out", text: "Each time you pull a fact out of memory, you change it: the path gets easier to find. That's why a quiz can teach more than another read-through.", highlight: "you change it", takeaway: "Retrieval is itself a form of study.", concept: 0 },
      { kind: "why", headline: "The best time to review is just before you forget", text: "Reviewing an idea when it has started to fade takes more effort — and that effort is what makes the memory last. Cramming skips it.", highlight: "just before you forget", takeaway: "Space your reviews; let a little forgetting happen.", concept: 1 },
    ],
    quiz: [
      { question: "In the 2006 study, which group remembered more after a week?", options: ["Those who reread several times", "Those who read once and were tested", "Both the same", "Those who highlighted"], correctIndex: 1, explanation: "Testing produced better long-term retention than repeated study.", concept: 0 },
    ],
    followUps: [
      { topic: "Desirable difficulties in learning", teaser: "Next: why harder practice sticks better." },
      { topic: "How interleaving beats blocked practice", teaser: "Next: mixing topics on purpose." },
    ],
  },
];

async function main() {
  const { usingHostedDb, client } = await import("../src/db");
  if (usingHostedDb) throw new Error("Refusing to seed demo content into a hosted database.");
  const { ensureDb } = await import("../src/db/bootstrap");
  await ensureDb();
  const { upsertCard, upsertConcept, addConceptEdge } = await import("../src/lib/engine/cards");
  const { indexForSearch } = await import("../src/lib/searchIndex");

  for (const d of DEMO) {
    const interest = (await client.execute({ sql: "SELECT id, name FROM interests WHERE slug = ?", args: [d.slug] })).rows[0] as any;
    if (!interest) continue;
    const interestId = Number(interest.id);
    for (const level of ["new_to_this", "some_background"] as const) {
      const existing = await client.execute({ sql: "SELECT id FROM deep_dives WHERE interest_id = ? AND level = ? AND topic = ?", args: [interestId, level, d.topic] });
      let diveId: number;
      if (existing.rows[0]) diveId = Number((existing.rows[0] as any).id);
      else {
        const seqRes = await client.execute({ sql: "SELECT COUNT(*) AS n FROM deep_dives WHERE interest_id = ? AND level = ?", args: [interestId, level] });
        const ins = await client.execute({
          sql: `INSERT INTO deep_dives (interest_id, topic, content, sources, level, seq, origin, status, quality_score, quality_notes, follow_up_topics, expanded_at)
                VALUES (?, ?, ?, ?, ?, ?, 'syllabus', 'published', 5, 'Demo content.', ?, current_timestamp) RETURNING id`,
          args: [interestId, d.topic, d.content, JSON.stringify(d.sources), level, Number((seqRes.rows[0] as any).n) + 1, JSON.stringify(d.followUps)],
        });
        diveId = Number((ins.rows[0] as any).id);
      }
      const conceptIds: number[] = [];
      for (const c of d.concepts) {
        const id = await upsertConcept({ interestId, name: c.name, definition: c.definition, difficulty: c.difficulty, deepDiveId: diveId });
        conceptIds.push(id);
        const pre = c.prereq ? d.concepts.findIndex((x) => x.name === c.prereq) : -1;
        if (pre >= 0 && conceptIds[pre]) await addConceptEdge(conceptIds[pre], id);
      }
      const base = { interestId, level, deepDiveId: diveId };
      let seq = 0;
      for (const [i, b] of d.bites.entries()) {
        await upsertCard({ ...base, type: "bite", conceptId: conceptIds[b.concept], seq: seq++, title: b.headline, body: b.text, payload: { kind: b.kind, highlight: b.highlight, takeaway: b.takeaway }, dedupeKey: `demo:${diveId}:bite:${i}` });
      }
      if (d.diagram) await upsertCard({ ...base, type: "visual", seq: seq++, title: d.topic, body: d.diagram.caption, payload: d.diagram, dedupeKey: `demo:${diveId}:visual` });
      if (d.myth) await upsertCard({ ...base, type: "myth", seq: seq++, title: d.myth.myth, body: d.myth.fact, payload: d.myth, dedupeKey: `demo:${diveId}:myth` });
      for (const [i, q] of d.quiz.entries()) {
        await upsertCard({ ...base, type: "quiz", conceptId: conceptIds[q.concept], seq: seq++, title: d.topic, body: q.question, payload: { options: q.options, correctIndex: q.correctIndex, explanation: q.explanation, kind: "selfcheck" }, dedupeKey: `demo:${diveId}:quiz:${i}` });
      }
      if (d.insight) await upsertCard({ ...base, type: "insight", seq: seq++, title: d.topic, body: d.insight, dedupeKey: `demo:${diveId}:insight` });
      await indexForSearch({ contentType: "deep_dive", sourceId: diveId, title: d.topic, body: d.content, interestLabel: interest.name, interestId, date: new Date().toISOString(), url: `/deep-dive/${diveId}`, userId: null });
    }
  }
  console.log(`Seeded ${DEMO.length} demo entries (at two levels each).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

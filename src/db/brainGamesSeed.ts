import type { BrainGameType } from "./schema";

export interface BrainGameSeed {
  gameType: BrainGameType;
  content: string;
  answer: string;
}

// Deterministic pseudo-random generator (mulberry32) so re-running the seed
// script produces the same bank rather than growing unboundedly — paired
// with seedBrainGames.ts's dedupe-by-content check.
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateQuickMath(rand: () => number, count: number): BrainGameSeed[] {
  const ops = ["+", "-", "×"] as const;
  const out: BrainGameSeed[] = [];
  for (let i = 0; i < count; i++) {
    const op = ops[Math.floor(rand() * ops.length)];
    let a: number, b: number, answer: number;
    if (op === "×") {
      a = Math.floor(rand() * 11) + 2; // 2-12
      b = Math.floor(rand() * 11) + 2;
      answer = a * b;
    } else {
      a = Math.floor(rand() * 80) + 10; // 10-89
      b = Math.floor(rand() * 80) + 10;
      if (op === "-" && b > a) [a, b] = [b, a]; // keep subtraction non-negative
      answer = op === "+" ? a + b : a - b;
    }
    out.push({ gameType: "quick_math", content: `${a} ${op} ${b} = ?`, answer: String(answer) });
  }
  return out;
}

function generatePatternCompletion(rand: () => number, count: number): BrainGameSeed[] {
  const out: BrainGameSeed[] = [];
  for (let i = 0; i < count; i++) {
    const kind = Math.floor(rand() * 3);
    const start = Math.floor(rand() * 10) + 1;
    let seq: number[];
    if (kind === 0) {
      // arithmetic progression
      const step = Math.floor(rand() * 8) + 2;
      seq = Array.from({ length: 5 }, (_, n) => start + n * step);
    } else if (kind === 1) {
      // geometric progression
      const ratio = Math.floor(rand() * 3) + 2;
      seq = Array.from({ length: 5 }, (_, n) => start * ratio ** n);
    } else {
      // alternating +a/-b style
      const a = Math.floor(rand() * 6) + 2;
      const b = Math.floor(rand() * 4) + 1;
      seq = [start];
      for (let n = 1; n < 5; n++) seq.push(n % 2 === 1 ? seq[n - 1] + a : seq[n - 1] - b);
    }
    const answer = seq[4];
    const shown = seq.slice(0, 4).join(", ");
    out.push({ gameType: "pattern_completion", content: `${shown}, ?`, answer: String(answer) });
  }
  return out;
}

const WORD_POOL = [
  "river",
  "lantern",
  "quiet",
  "copper",
  "meadow",
  "signal",
  "velvet",
  "orbit",
  "granite",
  "willow",
  "amber",
  "harbor",
  "cinder",
  "maple",
  "tundra",
  "ripple",
  "quartz",
  "ember",
  "canyon",
  "drift",
];

function generateWorkingMemorySpan(rand: () => number, count: number): BrainGameSeed[] {
  const out: BrainGameSeed[] = [];
  for (let i = 0; i < count; i++) {
    const useWords = i % 2 === 0;
    const length = 4 + (i % 3); // spans of 4, 5, 6
    const items: string[] = [];
    if (useWords) {
      const pool = [...WORD_POOL];
      for (let n = 0; n < length; n++) {
        const idx = Math.floor(rand() * pool.length);
        items.push(pool.splice(idx, 1)[0]);
      }
    } else {
      for (let n = 0; n < length; n++) items.push(String(Math.floor(rand() * 10)));
    }
    const sequence = items.join(", ");
    out.push({
      gameType: "working_memory_span",
      content: `Memorize this sequence, then try to recall it in order: ${sequence}`,
      answer: sequence,
    });
  }
  return out;
}

// Hand-authored — mini logic puzzles don't proceduralize well, unlike the
// three generators above.
const MINI_LOGIC_PUZZLES: BrainGameSeed[] = [
  {
    gameType: "mini_logic_puzzle",
    content:
      "Three friends — Ada, Ben, and Cleo — each own a different pet: a cat, a dog, and a fish. Ada " +
      "doesn't own the fish. Ben doesn't own the cat or the fish. Who owns which pet?",
    answer: "Ben owns the dog, Ada owns the cat, Cleo owns the fish.",
  },
  {
    gameType: "mini_logic_puzzle",
    content:
      "All squares are rectangles. This shape is not a rectangle. Can this shape be a square? Why or why not?",
    answer: "No — since every square is a rectangle, anything that isn't a rectangle can't be a square.",
  },
  {
    gameType: "mini_logic_puzzle",
    content:
      "A man looks at a portrait and says, 'Brothers and sisters I have none, but that man's father is " +
      "my father's son.' Who is in the portrait?",
    answer: "His own son. ('My father's son' with no siblings is the man himself.)",
  },
  {
    gameType: "mini_logic_puzzle",
    content:
      "If it's true that 'all professional chess players are patient,' does it follow that 'all patient " +
      "people are professional chess players'? Why or why not?",
    answer: "No — this reverses the conditional. Patience being necessary for chess mastery doesn't make it sufficient.",
  },
  {
    gameType: "mini_logic_puzzle",
    content:
      "You have two ropes, each of which takes exactly 60 minutes to burn, but they burn unevenly (not at " +
      "a constant rate). How do you measure exactly 45 minutes using only these two ropes and a lighter?",
    answer:
      "Light rope A at both ends and rope B at one end simultaneously. Rope A burns out after 30 minutes " +
      "— at that moment, light rope B's other end too. Rope B, now burning from both ends, finishes its " +
      "remaining 30 minutes of rope in 15 more minutes. Total: 30 + 15 = 45 minutes.",
  },
  {
    gameType: "mini_logic_puzzle",
    content:
      "Every time it rains, the ground gets wet. The ground is wet. Did it necessarily rain?",
    answer: "No — this is affirming the consequent. The ground could be wet for another reason (a sprinkler, a spill).",
  },
  {
    gameType: "mini_logic_puzzle",
    content:
      "Five people are in a race. Dana finishes before Eli but after Farah. Gia finishes before Farah. " +
      "Who finished first among these four?",
    answer: "Gia (order: Gia, Farah, Dana, Eli).",
  },
  {
    gameType: "mini_logic_puzzle",
    content:
      "A farmer has 17 sheep. All but 9 die. How many sheep does the farmer have left?",
    answer: "9 — 'all but 9 die' means 9 survive.",
  },
  {
    gameType: "mini_logic_puzzle",
    content:
      "If some critics are unreliable, and this reviewer is a critic, does it follow that this reviewer " +
      "is unreliable?",
    answer: "No — 'some' doesn't mean 'all'. This reviewer could be one of the reliable critics.",
  },
  {
    gameType: "mini_logic_puzzle",
    content:
      "A box contains only red and blue balls. You're told: 'if you draw a ball at random, it's more " +
      "likely to be red than blue.' Does that mean there are no blue balls in the box?",
    answer: "No — it just means red outnumbers blue. There could still be blue balls, just fewer of them.",
  },
  {
    gameType: "mini_logic_puzzle",
    content:
      "Two coins add up to 30 cents, and one of them is not a nickel. What are the two coins?",
    answer: "A quarter and a nickel — the quarter is 'the one that is not a nickel,' the other coin is a nickel.",
  },
  {
    gameType: "mini_logic_puzzle",
    content:
      "A study finds that ice cream sales and drowning deaths rise and fall together throughout the year. " +
      "Does eating ice cream cause drowning? If not, what's really going on?",
    answer: "No — both are driven by a common cause: hot weather increases both ice cream sales and swimming (and thus drowning risk).",
  },
  {
    gameType: "mini_logic_puzzle",
    content:
      "Only members can enter the club. Sam is not a member. What, if anything, can you conclude about " +
      "whether Sam can enter?",
    answer: "Sam cannot enter — 'only members can enter' means non-membership guarantees exclusion.",
  },
  {
    gameType: "mini_logic_puzzle",
    content:
      "A test for a rare disease (1 in 1,000 people have it) is 99% accurate. You test positive. Are you " +
      "more likely to have the disease or not?",
    answer:
      "More likely not, surprisingly — with 1,000 people, ~1 true positive but ~10 false positives (1% " +
      "of the 999 healthy people), so a positive result is still more likely a false alarm than the disease.",
  },
  {
    gameType: "mini_logic_puzzle",
    content:
      "Every time the alarm goes off, it's because of a fire. The alarm just went off. Is there necessarily a fire?",
    answer: "Not necessarily, if the stated rule isn't strictly true in practice — false alarms are common precisely because this inference feels airtight but often isn't.",
  },
];

// Generate a reasonably large bank for the three proceduralizable types —
// large enough that the no-repeat rotation (brainGames.ts) rarely reuses
// the same instance, without needing a fresh API call per game.
const rand = mulberry32(20260810);
export const BRAIN_GAMES_SEED: BrainGameSeed[] = [
  ...generateQuickMath(rand, 30),
  ...generatePatternCompletion(rand, 20),
  ...generateWorkingMemorySpan(rand, 20),
  ...MINI_LOGIC_PUZZLES,
];

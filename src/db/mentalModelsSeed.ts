import type { MentalModelCategory } from "./schema";

export interface MentalModelSeed {
  name: string;
  category: MentalModelCategory;
  description: string;
}

// ~40 general-purpose thinking tools, cross-cutting — not tied to any one
// interest. Used by the "Mental Model of the Day" lens card (pipeline.ts's
// refreshMentalModelForCycle), which connects one of these to real items
// from that day's feed.
export const MENTAL_MODELS_SEED: MentalModelSeed[] = [
  // --- Probabilistic / statistical thinking ---
  {
    name: "Base rates",
    category: "probabilistic",
    description:
      "The underlying frequency of something in a population, before you factor in specific evidence. " +
      "People routinely ignore base rates in favor of vivid specific details, even when the base rate " +
      "is far more informative (e.g. a rare disease test with a 5% false-positive rate still mostly " +
      "produces false positives if the disease itself is rare enough).",
  },
  {
    name: "Regression to the mean",
    category: "probabilistic",
    description:
      "Extreme results (very high or very low) tend to be followed by results closer to average, purely " +
      "from statistical noise — not because anything causal happened. Mistaking regression to the mean " +
      "for the effect of an intervention is one of the most common reasoning errors in everyday life.",
  },
  {
    name: "Bayesian updating",
    category: "probabilistic",
    description:
      "Treating belief as a probability that shifts incrementally as new evidence arrives, rather than " +
      "a binary switch that flips on one data point. Strong prior beliefs require strong evidence to " +
      "meaningfully move; weak priors move more easily.",
  },
  {
    name: "Sample size sensitivity",
    category: "probabilistic",
    description:
      "Small samples produce far noisier, more extreme results than large ones. A striking result from " +
      "a study of 20 people warrants much less confidence than the same result from 20,000.",
  },
  {
    name: "Law of large numbers",
    category: "probabilistic",
    description:
      "As a random process repeats more times, its average outcome converges toward its true expected " +
      "value. Short runs can look wildly unrepresentative of the underlying odds.",
  },
  {
    name: "Selection bias",
    category: "probabilistic",
    description:
      "When the process that produced your data isn't random, conclusions drawn from it can be " +
      "systematically skewed — e.g. surveying people who showed up to an event about how much they like " +
      "that kind of event.",
  },
  {
    name: "Margin of error thinking",
    category: "probabilistic",
    description:
      "Any measurement or poll has a range of plausible true values around the reported number, not just " +
      "the number itself. A 2-point lead in a poll with a 4-point margin of error isn't really a lead.",
  },
  {
    name: "Expected value",
    category: "probabilistic",
    description:
      "Weighing an outcome by its probability, not just its size — a small chance of a huge payoff can " +
      "have the same expected value as a near-certain small one, and decisions should often be judged by " +
      "this product rather than by the most vivid possible outcome.",
  },
  // --- Economic thinking ---
  {
    name: "Opportunity cost",
    category: "economic",
    description:
      "The value of the next-best alternative you give up by choosing one option — the real cost of a " +
      "choice includes what you didn't do with that time or money, not just what you spent.",
  },
  {
    name: "Marginal thinking",
    category: "economic",
    description:
      "Decisions are best evaluated by the change from one more (or one less) unit, not the average or " +
      "the whole. The right question is usually 'what does the next one cost/gain me', not 'what's the " +
      "overall picture'.",
  },
  {
    name: "Incentives",
    category: "economic",
    description:
      "People and institutions respond predictably to what's rewarded and punished, often more than to " +
      "stated intentions or rules — if you want to predict behavior, look at what's actually incentivized.",
  },
  {
    name: "Sunk cost fallacy",
    category: "economic",
    description:
      "Past investment (time, money, effort) that can't be recovered shouldn't factor into a forward-" +
      "looking decision, but people routinely let it — 'we've already put so much in' isn't a reason to " +
      "continue if the future expected value is negative.",
  },
  {
    name: "Comparative advantage",
    category: "economic",
    description:
      "Two parties can both benefit from specializing and trading even if one is better at everything in " +
      "absolute terms — what matters is relative efficiency, not absolute skill.",
  },
  {
    name: "Diminishing returns",
    category: "economic",
    description:
      "Each additional unit of input tends to produce a smaller gain in output than the last, past some " +
      "point — the first hour of study or the first employee hired usually helps more than the tenth.",
  },
  {
    name: "Supply and demand",
    category: "economic",
    description:
      "Prices and availability emerge from the interaction of how much people want something and how " +
      "much exists — shortages and surpluses are signals, not just facts, and tend to self-correct unless " +
      "something (like a price cap) blocks the adjustment.",
  },
  {
    name: "Principal-agent problem",
    category: "economic",
    description:
      "When one party (the agent) acts on behalf of another (the principal) but their incentives don't " +
      "fully align, the agent tends to act in their own interest at the principal's expense — a landlord " +
      "and tenant, or a manager and shareholders, are classic examples.",
  },
  // --- Systems thinking ---
  {
    name: "Second-order effects",
    category: "systems",
    description:
      "The consequences of the consequences — an intervention's immediate, intended effect is often not " +
      "the end of the story; what happens next, once people and systems adapt to the first effect, can " +
      "matter more.",
  },
  {
    name: "Feedback loops",
    category: "systems",
    description:
      "A system where outputs loop back to influence future inputs — reinforcing loops amplify change " +
      "(a viral trend, compound interest), balancing loops resist it (a thermostat, market correction).",
  },
  {
    name: "Emergence",
    category: "systems",
    description:
      "Complex, sometimes surprising system-level behavior can arise from simple rules followed by many " +
      "individual parts, with no single part 'containing' the emergent pattern — a flock of birds, a " +
      "traffic jam, a market crash.",
  },
  {
    name: "Bottlenecks / constraints",
    category: "systems",
    description:
      "A system's overall throughput is limited by its single scarcest resource or slowest step, not by " +
      "the average capacity of all its parts — improving anything other than the actual bottleneck often " +
      "does nothing for the whole.",
  },
  {
    name: "Path dependence",
    category: "systems",
    description:
      "Early choices — sometimes arbitrary or historically contingent ones — can lock a system into a " +
      "trajectory that's costly to reverse later, even if a different starting point would have led " +
      "somewhere better.",
  },
  {
    name: "Network effects",
    category: "systems",
    description:
      "A product or platform becomes more valuable to each user as more people use it — this can create " +
      "winner-take-most dynamics and make early adoption self-reinforcing.",
  },
  {
    name: "Tragedy of the commons",
    category: "systems",
    description:
      "When a shared resource is open to everyone and no one bears the full cost of overusing it, " +
      "individually rational behavior can collectively deplete or ruin the resource for everyone.",
  },
  {
    name: "Homeostasis",
    category: "systems",
    description:
      "Systems (biological, social, organizational) often actively resist change and pull back toward a " +
      "stable equilibrium — a single push rarely produces a permanent shift unless it changes the " +
      "equilibrium itself.",
  },
  // --- Logic / rigor ---
  {
    name: "Occam's razor",
    category: "logic",
    description:
      "Among explanations that fit the evidence equally well, prefer the one that requires the fewest " +
      "new assumptions — not because simpler is always true, but because it's the more testable, more " +
      "provisional starting point.",
  },
  {
    name: "Falsifiability",
    category: "logic",
    description:
      "A claim is only genuinely testable if there's some observation that could, in principle, prove it " +
      "wrong — claims engineered so that no evidence could ever count against them aren't really making a " +
      "risky prediction about the world.",
  },
  {
    name: "Survivorship bias",
    category: "logic",
    description:
      "Drawing conclusions only from the cases that 'survived' some filtering process, while the failures " +
      "went unseen and uncounted — studying only successful companies, or planes that returned from " +
      "combat, systematically misses what actually mattered.",
  },
  {
    name: "Correlation vs. causation",
    category: "logic",
    description:
      "Two things moving together doesn't establish that one causes the other — they might share a " +
      "common cause, the causation might run the other direction, or the link might be coincidence.",
  },
  {
    name: "Burden of proof",
    category: "logic",
    description:
      "The obligation to provide evidence lies with whoever is making a positive claim, not with whoever " +
      "is skeptical of it — 'you can't prove it's false' isn't evidence that it's true.",
  },
  {
    name: "Confirmation bias",
    category: "logic",
    description:
      "The tendency to notice, seek out, and remember evidence that supports what you already believe, " +
      "while overlooking or discounting evidence against it — actively deserves correcting for, since it " +
      "operates without feeling like bias from the inside.",
  },
  {
    name: "Null hypothesis thinking",
    category: "logic",
    description:
      "Start from the assumption that an observed effect is due to chance, and require the evidence to " +
      "overcome that default — a habit of mind that guards against seeing patterns in noise.",
  },
  {
    name: "Steelmanning",
    category: "logic",
    description:
      "Engaging with the strongest, most charitable version of an opposing argument, rather than the " +
      "weakest or easiest-to-dismiss version (a 'strawman') — a discipline that makes your own reasoning " +
      "more robust, not just fairer to the other side.",
  },
  // --- General ---
  {
    name: "Inversion",
    category: "general",
    description:
      "Instead of asking how to achieve a goal, ask what would guarantee failure — then avoid those " +
      "things. Working backward from failure often surfaces risks that forward planning misses.",
  },
  {
    name: "The map is not the territory",
    category: "general",
    description:
      "Any model, theory, label, or summary is a simplified representation of reality, not reality itself " +
      "— useful models are still incomplete, and mistaking the map for the territory leads to acting on " +
      "the model past the point where it stops matching the world.",
  },
  {
    name: "Circle of competence",
    category: "general",
    description:
      "Knowing the boundary of what you genuinely understand well, and being honest about when a question " +
      "falls outside it — confidence should track competence, not just how strongly you feel about " +
      "something.",
  },
  {
    name: "First principles thinking",
    category: "general",
    description:
      "Breaking a problem down to its most basic, verifiable truths and reasoning up from there, rather " +
      "than reasoning by analogy to how things are usually done — slower, but avoids inheriting " +
      "assumptions that no longer apply.",
  },
  {
    name: "Hanlon's razor",
    category: "general",
    description:
      "Don't attribute to malice what's adequately explained by incompetence, carelessness, or ordinary " +
      "self-interest — a useful default that avoids over-reading intent into outcomes that have simpler " +
      "explanations.",
  },
  {
    name: "Antifragility",
    category: "general",
    description:
      "Some systems don't just resist shocks (robustness) — they actually improve from moderate stress " +
      "and volatility, the way a muscle strengthens under load. Removing all stress from such a system can " +
      "quietly weaken it.",
  },
  {
    name: "Chesterton's fence",
    category: "general",
    description:
      "Before removing a rule, tradition, or structure that seems useless, first understand why it was " +
      "put there — it may be protecting against a problem that isn't visible until the fence is gone.",
  },
  {
    name: "Loss aversion",
    category: "general",
    description:
      "Losses tend to feel roughly twice as painful as equivalent gains feel good — this asymmetry shapes " +
      "decisions in ways that pure expected-value reasoning wouldn't predict, from investing to " +
      "negotiating.",
  },
  {
    name: "Availability heuristic",
    category: "general",
    description:
      "Judging how likely or common something is by how easily examples come to mind, rather than by " +
      "actual frequency — vivid, recent, or emotionally charged events are overweighted simply because " +
      "they're easier to recall.",
  },
];

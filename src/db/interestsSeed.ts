export interface InterestSeed {
  slug: string;
  name: string;
  description: string;
  hasCuratedSource: boolean;
  generatesAppliedInsights: boolean;
}

export const INTERESTS_SEED: InterestSeed[] = [
  {
    slug: "neuroscience",
    name: "Neuroscience & Psychobiology",
    description: "Brain and behavior — from molecules to cognition. The original Phase 1 pipeline.",
    hasCuratedSource: true,
    generatesAppliedInsights: true,
  },
  {
    slug: "psychology",
    name: "Psychology",
    description: "Cognitive, social, clinical, and developmental psychology research.",
    hasCuratedSource: true,
    generatesAppliedInsights: true,
  },
  {
    slug: "philosophy",
    name: "Philosophy",
    description: "Essays and arguments across ethics, epistemology, metaphysics, and philosophy of mind.",
    hasCuratedSource: true,
    generatesAppliedInsights: true,
  },
  {
    slug: "history",
    name: "History",
    description: "Scholarly essays on historical events, figures, and long-run trends.",
    hasCuratedSource: true,
    generatesAppliedInsights: false,
  },
  {
    slug: "economics",
    name: "Economics & Finance",
    description: "Macro/micro economics, markets, and finance — working papers and commentary.",
    hasCuratedSource: true,
    generatesAppliedInsights: true,
  },
  {
    slug: "business",
    name: "Business",
    description: "Strategy, management, and how companies actually work. News is a generated roundup.",
    hasCuratedSource: false,
    generatesAppliedInsights: true,
  },
  {
    slug: "political-science",
    name: "Political Science",
    description: "Institutions, governance, and political behavior. News is a generated roundup.",
    hasCuratedSource: false,
    generatesAppliedInsights: false,
  },
  {
    slug: "cs-ai",
    name: "Computer Science / AI",
    description: "Machine learning, systems, and the broader computer science research frontier.",
    hasCuratedSource: true,
    generatesAppliedInsights: false,
  },
  {
    slug: "physics",
    name: "Physics",
    description: "From condensed matter to cosmology — new results and open questions.",
    hasCuratedSource: true,
    generatesAppliedInsights: false,
  },
  // --- Phase 5 ---
  {
    slug: "critical-thinking",
    name: "Critical Thinking & Argumentation",
    description:
      "Practice spotting fallacies, reconstructing arguments, and checking validity — Drills are this " +
      "interest's primary content, not deep dives. News is a generated roundup of real arguments and " +
      "fallacies currently in circulation.",
    hasCuratedSource: false,
    generatesAppliedInsights: true,
  },
  {
    slug: "exercise-science",
    name: "Exercise Science",
    description: "Training, physiology, and the research behind what actually works.",
    hasCuratedSource: true,
    generatesAppliedInsights: true,
  },
  {
    slug: "philosophy-of-science",
    name: "Philosophy of Science",
    description: "What makes something scientific — theory-ladenness, falsifiability, and the demarcation problem.",
    hasCuratedSource: false,
    generatesAppliedInsights: false,
  },
  {
    slug: "mathematics",
    name: "Mathematics",
    description: "Pure and applied — from elegant proofs to the open problems mathematicians are chasing.",
    hasCuratedSource: true,
    generatesAppliedInsights: false,
  },
  {
    slug: "logic",
    name: "Logic",
    description: "Formal reasoning — syllogisms, validity and soundness, and mathematical logic research.",
    hasCuratedSource: true,
    generatesAppliedInsights: true,
  },
  {
    slug: "animal-world",
    name: "Animal World",
    description: "Animal behavior, cognition, and the science of how other species navigate their worlds.",
    hasCuratedSource: true,
    generatesAppliedInsights: false,
  },
  {
    slug: "biology",
    name: "Biology",
    description: "Molecular and cellular biology — the machinery underneath every living thing.",
    hasCuratedSource: true,
    generatesAppliedInsights: false,
  },
  {
    slug: "evolution",
    name: "Evolution",
    description: "Evolutionary biology and human origins — how species (and we) got this way.",
    hasCuratedSource: true,
    generatesAppliedInsights: false,
  },
];

export interface InterestSeed {
  slug: string;
  name: string;
  description: string;
  hasCuratedSource: boolean;
}

export const INTERESTS_SEED: InterestSeed[] = [
  {
    slug: "neuroscience",
    name: "Neuroscience & Psychobiology",
    description: "Brain and behavior — from molecules to cognition. The original Phase 1 pipeline.",
    hasCuratedSource: true,
  },
  {
    slug: "psychology",
    name: "Psychology",
    description: "Cognitive, social, clinical, and developmental psychology research.",
    hasCuratedSource: true,
  },
  {
    slug: "philosophy",
    name: "Philosophy",
    description: "Essays and arguments across ethics, epistemology, metaphysics, and philosophy of mind.",
    hasCuratedSource: true,
  },
  {
    slug: "history",
    name: "History",
    description: "Scholarly essays on historical events, figures, and long-run trends.",
    hasCuratedSource: true,
  },
  {
    slug: "economics",
    name: "Economics & Finance",
    description: "Macro/micro economics, markets, and finance — working papers and commentary.",
    hasCuratedSource: true,
  },
  {
    slug: "business",
    name: "Business",
    description: "Strategy, management, and how companies actually work. Deep-dive explainers only.",
    hasCuratedSource: false,
  },
  {
    slug: "political-science",
    name: "Political Science",
    description: "Institutions, governance, and political behavior. Deep-dive explainers only.",
    hasCuratedSource: false,
  },
  {
    slug: "cs-ai",
    name: "Computer Science / AI",
    description: "Machine learning, systems, and the broader computer science research frontier.",
    hasCuratedSource: true,
  },
  {
    slug: "physics",
    name: "Physics",
    description: "From condensed matter to cosmology — new results and open questions.",
    hasCuratedSource: true,
  },
];

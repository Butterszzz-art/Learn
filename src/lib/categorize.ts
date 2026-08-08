import type { Category } from "@/db/schema";
import { CATEGORIES } from "@/db/schema";
import type { RawItem } from "./types";

// Keyword rules, checked in this priority order (more specific first).
// Each item is tagged into exactly ONE category — the first rule set that
// matches wins.
const KEYWORD_RULES: { category: Category; patterns: RegExp[] }[] = [
  {
    category: "Quantum Biology",
    patterns: [
      /quantum biology/i,
      /quantum coherence/i,
      /quantum tunneling/i,
      /magnetoreception/i,
      /cryptochrome/i,
      /microtubule.*quantum|quantum.*microtubule/i,
      /orch-?or/i,
    ],
  },
  {
    category: "Computational Neuroscience",
    patterns: [
      /computational neuroscience/i,
      /neural network model/i,
      /spiking neural network/i,
      /connectome/i,
      /neural coding/i,
      /brain[- ]computer interface/i,
      /in silico/i,
      /simulat(ion|ed) (brain|neuron|cortex|network)/i,
      /machine learning.*(brain|neural|cortex)/i,
    ],
  },
  {
    category: "Behavioral Neuroscience",
    patterns: [
      /behavioral neuroscience/i,
      /\bbehaviou?r\b/i,
      /decision[- ]making/i,
      /reward (circuit|pathway|system)/i,
      /anxiety|depression|addiction/i,
      /learning and memory/i,
      /animal model/i,
      /psychobiology/i,
      /fear (conditioning|response)/i,
      /social behavior/i,
    ],
  },
];

/** Keyword-based fallback categorizer — used when no Anthropic API key is set. */
export function categorizeByKeywords(item: RawItem): Category {
  const haystack = `${item.title} ${item.snippet}`;
  for (const rule of KEYWORD_RULES) {
    if (rule.patterns.some((p) => p.test(haystack))) {
      return rule.category;
    }
  }
  return "General Neuroscience & Psychobiology";
}

export function isValidCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

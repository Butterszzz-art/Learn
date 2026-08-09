import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // "neuron" — renamed from the Phase 1 "brain" palette (Digest ->
        // Neuron) and re-tuned from a flat slate-blue scheme to a warmer,
        // more saturated violet/pink/teal trio for the bubbly redesign.
        neuron: {
          bg: "#120f1e",
          surface: "#1c1830",
          surface2: "#252041",
          border: "#372f56",
          text: "#f3f0ff",
          muted: "#a89fc9",
          accent: "#a78bfa", // violet — primary
          accent2: "#f472b6", // pink — secondary
          accent3: "#2dd4bf", // teal — sparing third pop (used for success-ish accents)
        },
      },
      fontFamily: {
        // Nunito (rounded body sans) + Fredoka (bubbly display face for
        // headings/logo) — see layout.tsx for the next/font/google setup.
        sans: ["var(--font-body)", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["var(--font-display)", "ui-rounded", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;

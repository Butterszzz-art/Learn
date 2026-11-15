import type { Config } from "tailwindcss";

// Colours resolve to CSS variables defined in globals.css, so one set of
// class names serves both the light and dark themes.
const token = (name: string) => `rgb(var(--n-${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/app/**/*.{js,ts,jsx,tsx,mdx}", "./src/components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        neuron: {
          bg: token("bg"),
          surface: token("surface"),
          surface2: token("surface2"),
          border: token("border"),
          text: token("text"),
          muted: token("muted"),
          accent: token("accent"), // violet — primary
          accent2: token("accent2"), // pink — secondary
          accent3: token("accent3"), // teal — success / "correct"
          danger: token("danger"),
          warn: token("warn"),
          onaccent: token("on-accent"),
        },
      },
      fontFamily: {
        sans: ["var(--font-body)", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["var(--font-display)", "ui-rounded", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;

import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brain: {
          bg: "#0f1115",
          surface: "#171a21",
          surface2: "#1e222b",
          border: "#2a2f3a",
          text: "#e6e8ec",
          muted: "#9aa2b1",
          accent: "#7c9fff",
          accent2: "#b98cf0",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        serif: ["ui-serif", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;

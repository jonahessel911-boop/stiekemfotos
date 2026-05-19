import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#f97316",
          foreground: "#ffffff",
          hover: "#ea580c",
          deep: "#c2410c",
        },
        accent: {
          DEFAULT: "#fb923c",
        },
        /** Lander varianten (bijv. /lander/2) — bordeaux / roze */
        lander: {
          DEFAULT: "#9B2242",
          foreground: "#ffffff",
          hover: "#7D1A35",
          deep: "#5C1228",
          light: "#FCE8EF",
          muted: "#F5D0DC",
        },
      },
      fontFamily: {
        sans: ["var(--font-poppins)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;

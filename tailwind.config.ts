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
          DEFAULT: "#dc2626",
          foreground: "#ffffff",
          hover: "#b91c1c",
          deep: "#991b1b",
        },
        accent: {
          DEFAULT: "#ef4444",
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
        sans: [
          "Tahoma",
          "Verdana",
          "MS Sans Serif",
          "Geneva",
          "Arial",
          "sans-serif",
        ],
        brand: [
          "Impact",
          "Arial Black",
          "Arial Narrow",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
export default config;

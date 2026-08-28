import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f1115",
        panel: "#171a21",
        edge: "#262b36",
        muted: "#8b93a7",
        accent: "#c8a962",
      },
      fontFamily: {
        sans: ["var(--font-app)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;

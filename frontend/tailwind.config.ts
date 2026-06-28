import type { Config } from "tailwindcss";

/**
 * Palette + font lifted verbatim from the UX mocks (`UX/mocks/*.html`) so the built
 * UI matches the approved design pixel-for-pixel.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bazak: { DEFAULT: "#6366f1", dark: "#4f46e5", light: "#eef2ff" },
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
      },
      keyframes: {
        typing: {
          "0%,60%,100%": { transform: "translateY(0)", opacity: "0.35" },
          "30%": { transform: "translateY(-4px)", opacity: "1" },
        },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        typing: "typing 1.2s infinite",
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [],
};

export default config;

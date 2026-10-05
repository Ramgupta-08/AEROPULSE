import type { Config } from "tailwindcss";

const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    // Fixed type scale: 12 / 13 / 14 / 16 / 20 / 24 / 32
    fontSize: {
      xs: ["12px", { lineHeight: "16px" }],
      sm: ["13px", { lineHeight: "18px" }],
      base: ["14px", { lineHeight: "20px" }],
      md: ["16px", { lineHeight: "24px" }],
      lg: ["20px", { lineHeight: "28px" }],
      xl: ["24px", { lineHeight: "32px" }],
      "2xl": ["32px", { lineHeight: "38px" }],
    },
    fontFamily: {
      sans: ['"Inter Variable"', "Inter", "system-ui", "sans-serif"],
      mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
    },
    colors: {
      transparent: "transparent",
      current: "currentColor",
      white: "#ffffff",
      black: "#000000",
      bg: token("bg"),
      surface: token("surface"),
      raised: token("raised"),
      border: token("border"),
      "border-strong": token("border-strong"),
      subtle: token("subtle"),
      body: token("body"),
      strong: token("strong"),
      accent: token("accent"),
      "accent-fg": token("accent-fg"),
      ready: token("ready"),
      caution: token("caution"),
      grounded: token("grounded"),
      info: token("info"),
    },
    extend: {
      borderRadius: { card: "10px" },
      opacity: { 12: "0.12", 8: "0.08", 16: "0.16" },
      letterSpacing: { label: "0.04em" },
      transitionTimingFunction: { out: "cubic-bezier(0.16, 1, 0.3, 1)" },
      keyframes: {
        "pulse-dot": { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.35" } },
      },
      animation: { "pulse-dot": "pulse-dot 2s ease-in-out infinite" },
    },
  },
  plugins: [],
} satisfies Config;

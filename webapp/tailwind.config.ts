import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-heebo)", "Heebo", "Arial", "sans-serif"],
      },
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#e0eaff",
          200: "#c7d7fe",
          300: "#a4bcfd",
          400: "#8098f9",
          500: "#6172f3",
          600: "#4650e6",
          700: "#3a3fc9",
          800: "#3235a2",
          900: "#2d3080",
          950: "#1b1c4c",
        },
        ink: {
          50: "#f7f8fa",
          100: "#eef0f4",
          200: "#dde1e9",
          300: "#c3cad6",
          400: "#9aa6b8",
          500: "#79879d",
          600: "#5f6d82",
          700: "#4d586a",
          800: "#40495858",
          900: "#252b35",
          950: "#161a21",
        },
        success: {
          50: "#ecfdf5",
          100: "#d1fae5",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
        },
        warning: {
          50: "#fffbeb",
          100: "#fef3c7",
          500: "#f59e0b",
          600: "#d97706",
        },
        danger: {
          50: "#fef2f2",
          100: "#fee2e2",
          500: "#ef4444",
          600: "#dc2626",
        },
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)",
        "card-hover": "0 4px 12px -2px rgb(0 0 0 / 0.08), 0 2px 6px -2px rgb(0 0 0 / 0.06)",
        popover: "0 10px 30px -5px rgb(0 0 0 / 0.15)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
      animation: {
        "fade-in": "fadeIn .2s ease-out",
        "slide-up": "slideUp .25s cubic-bezier(.16,1,.3,1)",
        "scale-in": "scaleIn .15s ease-out",
      },
      keyframes: {
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        slideUp: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        scaleIn: {
          from: { opacity: "0", transform: "scale(.97)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;

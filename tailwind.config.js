/** @type {import('tailwindcss').Config} */
// Colours map to the design-system tokens in styles/globals.css (RGB channels), so every
// variant works and light/dark/tenant brand colour switch in one place. Use these semantic
// names in pages — not raw gray/slate/white/hex (enforced by scripts/check-design-tokens.js).
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './layouts/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: v('primary'),
          hover: v('primary-hover'),
          // Fixed shades kept for the few legacy uses; prefer DEFAULT/hover.
          50: '#eff6ff',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        'on-primary': v('on-primary'),
        secondary: { DEFAULT: v('secondary'), hover: v('secondary') },
        background: { DEFAULT: v('bg'), secondary: v('surface-elevated') },
        surface: { DEFAULT: v('surface'), elevated: v('surface-elevated'), hover: v('surface-hover') },
        'on-surface': { DEFAULT: v('text'), secondary: v('text-2') },
        muted: v('muted'),
        subtle: v('muted'),
        success: { DEFAULT: v('success'), bg: v('success-bg') },
        warning: { DEFAULT: v('warning'), bg: v('warning-bg') },
        danger: { DEFAULT: v('danger'), bg: v('danger-bg') },
        info: { DEFAULT: v('info'), bg: v('info-bg') },
      },
      // Accent text uses a variant that stays readable on the theme's surfaces.
      textColor: {
        primary: { DEFAULT: v('primary-text'), hover: v('primary-text'), 600: '#2563eb', 700: '#1d4ed8' },
      },
      borderColor: {
        DEFAULT: v('border'),
        default: v('border'),
        strong: v('border-strong'),
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)',
      },
    },
  },
  darkMode: 'class',
  plugins: [],
}

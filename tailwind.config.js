/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#3b82f6',
          50: '#eff6ff',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          'hover': '#2563eb',
        },
        secondary: {
          DEFAULT: '#10b981',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          'hover': '#059669',
        },
        surface: '#ffffff',
        'on-surface': '#1f2937',
        subtle: '#6b7280',
      },
    },
  },
  darkMode: 'class',
  plugins: [],
}

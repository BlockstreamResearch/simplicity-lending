/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: 'var(--token-color-brand-50)',
          500: 'var(--token-color-brand-500)',
          700: 'var(--token-color-brand-700)',
        },
      },
    },
  },
  plugins: [],
}

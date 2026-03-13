import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        thai: ['var(--font-thai)', 'Sarabun', 'sans-serif'],
        display: ['var(--font-display)', 'sans-serif'],
        body: ['var(--font-thai)', 'Sarabun', 'sans-serif'],
      },
      colors: {
        accent: {
          DEFAULT: '#4fd1c5',
          dark: '#38b2ac',
        },
        surface: {
          DEFAULT: 'rgba(255, 255, 255, 0.05)',
          hover: 'rgba(255, 255, 255, 0.08)',
          active: 'rgba(255, 255, 255, 0.1)',
        },
      },
    },
  },
  plugins: [],
}
export default config

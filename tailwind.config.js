/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Legacy token names, remapped to the Dynasty palette so every
        // existing class picks up the new theme.
        sleeper: {
          dark: '#0e0d11', // page ink
          darker: '#16141a', // panel surface
          accent: '#d4b26a', // champagne gold
          green: '#3ddc97', // emerald
          red: '#e5484d', // crimson
        },
        gold: {
          300: '#eddcae',
          400: '#e2c987',
          500: '#d4b26a',
          600: '#b89347',
        },
        // Warm neutral scale replacing Tailwind's blue-tinted grays so
        // borders, dividers, and muted text sit naturally on warm ink.
        gray: {
          50: '#f7f6f4',
          100: '#e9e7e2',
          200: '#d4d1c9',
          300: '#b5b1a6',
          400: '#8e8a7e',
          500: '#6e6a60',
          600: '#55524a',
          700: '#403d37',
          800: '#2a2823',
          900: '#1b1a16',
          950: '#121110',
        },
      },
      fontFamily: {
        sans: ['var(--font-body)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Georgia', 'serif'],
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 10px 30px -12px rgba(0,0,0,0.5)',
        'gold-glow': '0 0 24px -6px rgba(212,178,106,0.45)',
      },
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        rise: 'rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
};

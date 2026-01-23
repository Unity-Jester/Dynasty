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
        sleeper: {
          dark: '#1a1a2e',
          darker: '#16162a',
          accent: '#00d4ff',
          green: '#01f87f',
          red: '#ff6b6b',
        },
      },
    },
  },
  plugins: [],
};

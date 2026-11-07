/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        obsidian: { 950: '#090A0F', 900: '#0F1118', 800: '#161925', 700: '#22263A' },
        pulse: { red: '#E50914', cyan: '#00F0FF', amber: '#FFB020' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
}

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the same build works on GitHub Pages (/kinopulse-app/) and inside the Capacitor WebView.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { target: 'es2019', sourcemap: false },
})

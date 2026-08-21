import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  test: {
    environment: 'jsdom',
    // The default worker_threads pool loses the suite context under jsdom on
    // Windows once the whole suite runs at once ("Vitest failed to find the
    // current suite" in every setup file). Forks are stable and faster here.
    pool: 'forks',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: true,
    coverage: {
      reporter: ['text', 'html'],
    },
  },
})

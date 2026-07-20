import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/testSetup.ts',
    // Security tests require the Firestore emulator and run only via test:rules.
    include: ['src/**/*.test.{ts,tsx}'],
  },
})

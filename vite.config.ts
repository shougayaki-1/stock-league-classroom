import { execFileSync } from 'node:child_process'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/** CI supplies the SHA; a local build falls back to git so the value is never a lie. */
const commitSha = process.env.VITE_COMMIT_SHA || (() => {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() }
  catch { return 'unknown' }
})()

/** Stamps the build into the HTML so the live version is identifiable without a login. */
const stampVersion = () => ({
  name: 'stamp-version',
  transformIndexHtml: (html: string) => html.replace('</head>', `  <meta name="version" content="${commitSha}" />\n  </head>`),
})

// https://vite.dev/config/
export default defineConfig({
  define: { 'import.meta.env.VITE_COMMIT_SHA': JSON.stringify(commitSha) },
  plugins: [react(), stampVersion()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/testSetup.ts',
    // Security/emulator tests require the RTDB or Firestore emulator and run only via test:rules.
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', 'src/lib/teacher/marketDeletion.test.ts'],
  },
})

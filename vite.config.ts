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
  // `@stock-league/lesson-inputs` is a symlinked workspace package (npm
  // workspaces -> node_modules/@stock-league/lesson-inputs) whose `main`
  // is CommonJS (functions/packages/lesson-inputs's tsconfig targets
  // `module: commonjs` for the Cloud Functions runtime). Vite does not
  // pre-bundle symlinked deps by default, so without this it is served
  // straight from `dist/index.js` as-is under `npm run dev`, and the
  // browser's native ESM loader cannot resolve CJS `module.exports` as
  // named imports (`import { validateLessonInput } from
  // '@stock-league/lesson-inputs'` in LessonInputRenderer.tsx). Forcing
  // it through esbuild's dependency pre-bundling converts it to ESM like
  // any other dependency. `vite build` and `vitest` are unaffected
  // (Rollup's commonjs plugin / Vite's SSR transform already handle this).
  optimizeDeps: { include: ['@stock-league/lesson-inputs'] },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/testSetup.ts',
    // Security/emulator tests require the RTDB or Firestore emulator and run only via test:rules.
    // `test/*.acceptance.test.ts` (Task 18) is the one exception: it imports
    // functions/src/lessonRuns/* directly (no Firestore/RTDB emulator, no
    // Cloud Functions runtime — pure in-memory fakes, same pattern as every
    // functions/src/**/*.test.ts) to exercise Task 1-17's already-shipped
    // functions together as one cross-cutting lesson lifecycle, the way no
    // single task's own test file does.
    include: ['src/**/*.test.{ts,tsx}', 'test/*.acceptance.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', 'src/lib/lessonTemplates/repository.test.ts'],
  },
})

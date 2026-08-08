import { defineConfig } from 'vitest/config'

/** Concurrency tests (spec §30-4) run against a real Firestore Emulator via
 * `firebase emulators:exec`, not the normal `vitest run` suite — separate
 * config mirrors the root project's `vite.rules.config.ts` pattern. */
export default defineConfig({
  test: { environment: 'node', include: ['src/market/concurrentBatch.test.ts'] },
})

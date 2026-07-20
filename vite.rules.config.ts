import { defineConfig } from 'vitest/config'

/** Rules tests run within firebase emulators:exec, not the normal browser suite. */
export default defineConfig({
  test: { environment: 'node', include: ['test/firestore.rules.test.ts'] },
})

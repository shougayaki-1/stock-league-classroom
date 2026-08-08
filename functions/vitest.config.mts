import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // concurrentBatch.test.ts requires a running Firestore Emulator (spec
    // §30-4) — it is run separately via `npm run test:market-concurrency`
    // (root), wrapped in `firebase emulators:exec`, not by the plain
    // `vitest run` this config drives.
    exclude: [...configDefaults.exclude, 'lib/**', 'src/market/concurrentBatch.test.ts'],
  },
})

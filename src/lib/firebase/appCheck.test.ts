import { describe, expect, it } from 'vitest'
import { initializeAppCheck } from './appCheck'
describe('App Check configuration', () => {
  it('explicitly skips App Check for emulator traffic', () => expect(initializeAppCheck({} as never, { VITE_USE_EMULATORS: 'true' })).toBeUndefined())
  it('allows local development without a site key', () => expect(initializeAppCheck({} as never, { DEV: true })).toBeUndefined())
  it('fails closed when production has no site key', () => expect(() => initializeAppCheck({} as never, { PROD: true })).toThrow(/SITE_KEY/))
  it('rejects a production debug token', () => expect(() => initializeAppCheck({} as never, { PROD: true, VITE_FIREBASE_APP_CHECK_SITE_KEY: 'key', VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN: 'debug' })).toThrow(/debug token/i))
})

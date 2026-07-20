import { describe, expect, it } from 'vitest'
import { initializeAppCheck } from './appCheck'
describe('App Check configuration', () => {
  it('explicitly skips App Check for emulator traffic', () => expect(initializeAppCheck({} as never, { VITE_USE_EMULATORS: 'true' })).toBeUndefined())
  it('fails closed when non-emulator traffic has no site key', () => expect(() => initializeAppCheck({} as never, {})).toThrow(/APP_CHECK_SITE_KEY/))
})

import { describe, expect, it } from 'vitest'
import { shouldUseEmulators } from './useEmulators'
describe('shouldUseEmulators', () => { it('only enables on explicit true', () => { expect(shouldUseEmulators({ VITE_USE_EMULATORS: 'true' })).toBe(true); expect(shouldUseEmulators({})).toBe(false) }) })

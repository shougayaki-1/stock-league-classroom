import { describe, expect, it, vi } from 'vitest'
import { createFirebaseBootstrapper } from './bootstrap'
describe('Firebase bootstrap', () => {
  it('initializes services and emulator connections once before consumers', () => {
    const services = { app: {} as never, auth: {} as never, firestore: {} as never, database: {} as never, functions: {} as never }
    const getServices = vi.fn(() => services), connectToEmulators = vi.fn(), initializeAppCheck = vi.fn(() => undefined)
    const bootstrap = createFirebaseBootstrapper({ getServices, connectToEmulators, initializeAppCheck })
    expect(bootstrap({ VITE_USE_EMULATORS: 'true' })).toEqual({ ...services, appCheck: undefined })
    bootstrap({ VITE_USE_EMULATORS: 'true' })
    expect(getServices).toHaveBeenCalledTimes(1); expect(connectToEmulators).toHaveBeenCalledTimes(1); expect(initializeAppCheck).toHaveBeenCalledTimes(1)
    expect(connectToEmulators).toHaveBeenCalledWith(services.auth, services.firestore, services.database, services.functions)
  })
  it('does not connect emulators unless explicitly requested', () => {
    const bootstrap = createFirebaseBootstrapper({ getServices: () => ({ app: {} as never, auth: {} as never, firestore: {} as never, database: {} as never, functions: {} as never }), connectToEmulators: vi.fn(), initializeAppCheck: vi.fn(() => undefined) })
    expect(() => bootstrap({ VITE_FIREBASE_APP_CHECK_SITE_KEY: 'key' })).not.toThrow()
  })
})

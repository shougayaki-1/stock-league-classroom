import { describe, expect, it } from 'vitest'
import { readFirebaseEnvConfig } from './firebaseConfig'
const valid = { VITE_FIREBASE_API_KEY: 'k', VITE_FIREBASE_AUTH_DOMAIN: 'd', VITE_FIREBASE_PROJECT_ID: 'p', VITE_FIREBASE_STORAGE_BUCKET: 'b', VITE_FIREBASE_MESSAGING_SENDER_ID: 's', VITE_FIREBASE_APP_ID: 'a', VITE_FIREBASE_DATABASE_URL: 'u' }
describe('readFirebaseEnvConfig', () => {
  it('returns a complete config', () => expect(readFirebaseEnvConfig(valid).projectId).toBe('p'))
  it('names missing variables', () => expect(() => readFirebaseEnvConfig({ VITE_FIREBASE_API_KEY: 'k' })).toThrow(/Missing Firebase env vars/))
})

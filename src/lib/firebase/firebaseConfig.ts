import { getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getDatabase, type Database } from 'firebase/database'
import { getFirestore, type Firestore } from 'firebase/firestore'

export interface FirebaseEnvConfig {
  apiKey: string; authDomain: string; projectId: string; storageBucket: string
  messagingSenderId: string; appId: string; databaseURL: string
}
const requiredKeys = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_APP_ID', 'VITE_FIREBASE_DATABASE_URL'] as const
const localHostnames = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Firebase's redirect handler must live on the same site as the app when a
 * custom Hosting domain is used. Keeping the configured Firebase domain for
 * local development avoids changing the emulator/auth setup.
 */
export const resolveBrowserAuthDomain = (configuredDomain: string, hostname?: string): string => {
  if (!hostname || localHostnames.has(hostname)) return configuredDomain
  return hostname
}

export const readFirebaseEnvConfig = (env: Record<string, string | undefined>): FirebaseEnvConfig => {
  const missing = requiredKeys.filter((key) => !env[key])
  if (missing.length) throw new Error(`Missing Firebase env vars: ${missing.join(', ')}`)
  const hostname = typeof window !== 'undefined' ? window.location.hostname : undefined
  return { apiKey: env.VITE_FIREBASE_API_KEY!, authDomain: resolveBrowserAuthDomain(env.VITE_FIREBASE_AUTH_DOMAIN!, hostname), projectId: env.VITE_FIREBASE_PROJECT_ID!, storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET!, messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID!, appId: env.VITE_FIREBASE_APP_ID!, databaseURL: env.VITE_FIREBASE_DATABASE_URL! }
}
export const getFirebaseApp = (env: Record<string, string | undefined> = import.meta.env): FirebaseApp => getApps()[0] ?? initializeApp(readFirebaseEnvConfig(env))
export const getFirebaseAuth = (): Auth => getAuth(getFirebaseApp())
export const getFirestoreDb = (): Firestore => getFirestore(getFirebaseApp())
export const getRealtimeDb = (): Database => getDatabase(getFirebaseApp())

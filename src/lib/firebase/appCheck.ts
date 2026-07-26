import { initializeAppCheck as initializeFirebaseAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check'
import type { FirebaseApp } from 'firebase/app'

type RuntimeEnv = Record<string, string | boolean | undefined>

/** Production fails closed when App Check is not configured. */
export const initializeAppCheck = (app: FirebaseApp, env: RuntimeEnv = import.meta.env): AppCheck | undefined => {
  if (env.VITE_USE_EMULATORS === 'true') return undefined
  const siteKey = env.VITE_FIREBASE_APP_CHECK_SITE_KEY
  const production = env.PROD === true || env.MODE === 'production'
  if (!siteKey) {
    if (production) throw new Error('Missing VITE_FIREBASE_APP_CHECK_SITE_KEY in production')
    return undefined
  }
  // The SDK reads this global while initializing; it must be set first.
  if (env.VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN) {
    if (production) throw new Error('App Check debug tokens must not be bundled in production')
    if (typeof window !== 'undefined') window.FIREBASE_APPCHECK_DEBUG_TOKEN = String(env.VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN)
  }
  return initializeFirebaseAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(String(siteKey)), isTokenAutoRefreshEnabled: true })
}

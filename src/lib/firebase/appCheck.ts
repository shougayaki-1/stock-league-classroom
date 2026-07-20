import { initializeAppCheck as initializeFirebaseAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check'
import type { FirebaseApp } from 'firebase/app'

/** Emulator traffic is explicitly exempt. Non-emulator builds require a site key. */
export const initializeAppCheck = (app: FirebaseApp, env: Record<string, string | undefined> = import.meta.env): AppCheck | undefined => {
  if (env.VITE_USE_EMULATORS === 'true') return undefined
  const siteKey = env.VITE_FIREBASE_APP_CHECK_SITE_KEY
  if (!siteKey) throw new Error('Missing VITE_FIREBASE_APP_CHECK_SITE_KEY for non-emulator Firebase use')
  // The SDK reads this global while initializing; it must be set first.
  if (env.VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN && typeof window !== 'undefined') window.FIREBASE_APPCHECK_DEBUG_TOKEN = env.VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN
  return initializeFirebaseAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true })
}

import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check'
import type { FirebaseApp } from 'firebase/app'

/** Initializes App Check only when a production site key is supplied. */
export const initializeAppCheckIfConfigured = (app: FirebaseApp, env: Record<string, string | undefined> = import.meta.env): AppCheck | undefined => {
  if (env.VITE_USE_EMULATORS === 'true') {
    if (env.VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN && typeof window !== 'undefined') window.FIREBASE_APPCHECK_DEBUG_TOKEN = env.VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN
    return undefined
  }
  const siteKey = env.VITE_FIREBASE_APP_CHECK_SITE_KEY
  return siteKey ? initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true }) : undefined
}

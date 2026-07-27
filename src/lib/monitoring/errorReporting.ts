import * as Sentry from '@sentry/react'

type RuntimeEnv = Record<string, string | boolean | undefined>

/** Values a report must never carry off our own infrastructure. */
const JOIN_CODE = /\b[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}\b/g
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g

/**
 * Students are minors and never register an account, so the privacy policy
 * promises that no identifying value leaves the app. Display names and join
 * codes reach us only by being embedded in an error string, so scrub the text
 * itself rather than relying on Sentry's own PII toggles.
 */
export const scrubText = (value: string): string => value.replace(EMAIL, '[email]').replace(JOIN_CODE, '[code]')

const scrubEvent = (event: Sentry.ErrorEvent): Sentry.ErrorEvent => {
  delete event.user
  delete event.server_name
  if (event.request) delete event.request.cookies
  for (const entry of event.exception?.values ?? []) {
    if (entry.value) entry.value = scrubText(entry.value)
  }
  if (event.message) event.message = scrubText(event.message)
  event.breadcrumbs = undefined
  return event
}

/** Returns false when reporting stays off, so callers can log locally instead. */
export const initializeErrorReporting = (env: RuntimeEnv = import.meta.env): boolean => {
  const dsn = env.VITE_SENTRY_DSN
  if (!dsn || env.VITE_USE_EMULATORS === 'true') return false
  Sentry.init({
    dsn: String(dsn),
    environment: env.MODE === 'production' ? 'production' : 'development',
    release: typeof env.VITE_COMMIT_SHA === 'string' ? env.VITE_COMMIT_SHA : undefined,
    sendDefaultPii: false,
    // No session replay and no tracing: both would capture classroom screens
    // and student-entered text.
    integrations: [],
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
    beforeBreadcrumb: () => null,
  })
  return true
}

export const reportError = (error: unknown) => Sentry.captureException(error)

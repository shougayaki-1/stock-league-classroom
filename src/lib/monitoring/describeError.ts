import { reportError } from './errorReporting'

const codeOf = (error: unknown): string =>
  typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code).toLowerCase() : ''

/**
 * A teacher standing in front of a class needs to know which of three things
 * went wrong — their permission, the network, or the free-tier ceiling —
 * because the response to each is different.
 */
export const describeError = (error: unknown, fallback: string): string => {
  const code = codeOf(error)
  if (code.includes('permission') || code.includes('unauthenticated')) return 'この操作の権限がありません。教師アカウントでログインしているか、この市場の作成者であるかを確認してください。'
  if (code.includes('unavailable') || code.includes('network') || code.includes('deadline')) return '通信が不安定です。ネットワークを確認して、もう一度お試しください。'
  if (code.includes('resource-exhausted') || code.includes('quota')) return '同時利用が上限に達しています。しばらく待つと復帰します。'
  return fallback
}

/**
 * The host tick runs once a second for the whole lesson, so a sustained
 * failure (a rules misconfiguration, an RTDB outage, quota exhaustion) would
 * otherwise call reportError once per second for as long as the tab stays
 * open. One minute is short enough that a genuinely recurring problem still
 * lands in Sentry many times over a class period, and long enough that a
 * lesson stuck on one failure produces tens of events rather than thousands.
 */
export const ERROR_REPORT_COOLDOWN_MILLIS = 60_000

/**
 * Keyed by the failure's cause (error code) plus the call site (fallback
 * message), never by user-entered text — that key never leaves this module,
 * but keeping it free of student input means it can never accidentally slip
 * into a report either. Different failures at the same call site, or the
 * same failure at different call sites, each get their own cooldown so they
 * are never suppressed by an unrelated failure's throttle.
 */
const lastReportedAtMillis = new Map<string, number>()
const throttleKey = (error: unknown, fallback: string): string => `${codeOf(error)}|${fallback}`

/** Report first, then explain: a swallowed error is one we can never fix. */
export const handleFailure = (error: unknown, fallback: string, nowMillis: () => number = Date.now): string => {
  const key = throttleKey(error, fallback)
  const now = nowMillis()
  const last = lastReportedAtMillis.get(key)
  if (last === undefined || now - last >= ERROR_REPORT_COOLDOWN_MILLIS) {
    lastReportedAtMillis.set(key, now)
    reportError(error)
  }
  return describeError(error, fallback)
}

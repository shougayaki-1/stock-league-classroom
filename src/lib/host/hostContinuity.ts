import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The market only advances while the host tab is foregrounded: browsers throttle
 * setInterval to roughly once a minute in a background tab, and the lease expires
 * after 15 seconds. These hooks exist so the teacher can never be unaware of that.
 */
export const useDocumentHidden = (): boolean => {
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden')
  useEffect(() => {
    const update = () => setHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return hidden
}

export const describeInterruption = (hiddenSinceMillis: number, nowMillis: number): string => {
  const seconds = Math.max(0, Math.round((nowMillis - hiddenSinceMillis) / 1000))
  return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒`
}

export interface HostInterruption {
  /** Set once the tab actually returns to the foreground; null otherwise. */
  message: string | null
  /** Clears the current message. A later, genuine interruption reports again regardless. */
  dismiss: () => void
}

/**
 * Interruptions shorter than this can never have mattered: the host lease itself
 * is 15 seconds, so a hide-to-visible span under this threshold cannot possibly
 * have let the lease expire. Kept a bit below the lease TTL as a safety margin
 * rather than exactly at it. Below this, no message is produced at all.
 */
export const MIN_REPORTABLE_INTERRUPTION_MS = 10_000

/**
 * Reports how long the tab was actually hidden, measured from the moment it went
 * hidden to the moment it actually becomes visible again — deliberately independent
 * of the host lease. Losing the lease while still hidden (the most common real
 * sequence: background the tab, the throttled tick lets the 15s lease expire) must
 * not by itself end or report an interruption; only the tab genuinely returning does.
 * A hidden tab cannot render anything, so the message is only ever produced on return.
 *
 * `active` gates only the *start* of tracking, not the end: a hide that happens
 * while this browser is not the acting host is never worth reporting, even if the
 * lease is later taken while still hidden. Conversely, once tracking has started
 * because this browser was hosting, losing `active` while still hidden must not
 * clear or short-circuit anything — that is exactly the case worth reporting, and
 * the span is still measured through to the real return.
 */
export const useHostInterruption = (active: boolean): HostInterruption => {
  const hidden = useDocumentHidden()
  const [message, setMessage] = useState<string | null>(null)
  const hiddenSince = useRef<number | null>(null)
  const activeRef = useRef(active)

  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    if (hidden) {
      if (hiddenSince.current === null && activeRef.current) hiddenSince.current = Date.now()
      return
    }
    const since = hiddenSince.current
    hiddenSince.current = null
    if (since === null) return
    const now = Date.now()
    if (now - since >= MIN_REPORTABLE_INTERRUPTION_MS) setMessage(describeInterruption(since, now))
  }, [hidden])

  const dismiss = useCallback(() => setMessage(null), [])
  return { message, dismiss }
}

/** Keeps the laptop screen awake so the lesson does not stop when the teacher steps away. */
export const useWakeLock = (active: boolean) => {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
    let sentinel: WakeLockSentinel | undefined
    let released = false
    const request = async () => {
      try {
        const acquired = await navigator.wakeLock.request('screen')
        // The effect may have been cleaned up while this await was pending
        // (e.g. the lease was taken and immediately lost). Release it right
        // away instead of storing a sentinel nothing will ever release.
        if (released) { void acquired.release().catch(() => undefined); return }
        sentinel = acquired
      } catch { /* denied or unsupported; the banner still warns */ }
    }
    const reacquire = () => { if (!released && document.visibilityState === 'visible') void request() }
    void request()
    document.addEventListener('visibilitychange', reacquire)
    return () => { released = true; document.removeEventListener('visibilitychange', reacquire); void sentinel?.release().catch(() => undefined) }
  }, [active])
}

export const useUnloadWarning = (active: boolean) => {
  useEffect(() => {
    if (!active) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [active])
}

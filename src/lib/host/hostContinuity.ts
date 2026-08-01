import { useEffect, useRef, useState } from 'react'

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

/** Timestamp the tab was last backgrounded while hosting, or null while it is visible. */
export const useHiddenSince = (active: boolean): number | null => {
  const hidden = useDocumentHidden()
  const [since, setSince] = useState<number | null>(null)
  const wasHidden = useRef(false)
  useEffect(() => {
    if (!active) { setSince(null); wasHidden.current = false; return }
    if (hidden && !wasHidden.current) { wasHidden.current = true; setSince(Date.now()) }
    if (!hidden) wasHidden.current = false
  }, [active, hidden])
  return hidden ? since : null
}

export const describeInterruption = (hiddenSinceMillis: number, nowMillis: number): string => {
  const seconds = Math.max(0, Math.round((nowMillis - hiddenSinceMillis) / 1000))
  return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒`
}

/** Keeps the laptop screen awake so the lesson does not stop when the teacher steps away. */
export const useWakeLock = (active: boolean) => {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
    let sentinel: WakeLockSentinel | undefined
    let released = false
    const request = async () => {
      try { sentinel = await navigator.wakeLock.request('screen') } catch { /* denied or unsupported; the banner still warns */ }
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

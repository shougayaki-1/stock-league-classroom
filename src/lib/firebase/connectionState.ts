import { useEffect, useState } from 'react'
import { goOffline, goOnline, onValue, ref, type Database } from 'firebase/database'

/** Long enough to ignore the normal reconnect blips of a school network. */
export const OFFLINE_GRACE_MS = 12_000
/** A student switching apps for a moment should not pay a reconnect. */
export const HIDDEN_IDLE_MS = 60_000
/** Lets the closing snapshots land before a finished market lets go. */
export const ENDED_SETTLE_MS = 15_000

/** Raw connection state. Flips to false on any drop, wanted or not. */
export const useDatabaseConnected = (database: Database): boolean => {
  const [connected, setConnected] = useState(false)
  useEffect(() => onValue(ref(database, '.info/connected'), (snapshot) => setConnected(snapshot.val() === true)), [database])
  return connected
}

interface OfflineOptions { suspended?: boolean; graceMs?: number }

/**
 * Reports a sustained *unintended* loss of the connection.
 *
 * The data listeners only report permission errors. A refused connection — the
 * shape a Spark-plan concurrent-connection limit takes — never reaches them, so
 * the screen would otherwise sit on "connecting" forever with no explanation.
 *
 * `suspended` marks a disconnection we asked for, which is never a fault.
 */
export const useDatabaseOffline = (database: Database, { suspended = false, graceMs = OFFLINE_GRACE_MS }: OfflineOptions = {}): boolean => {
  const connected = useDatabaseConnected(database)
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    if (connected || suspended) { setOffline(false); return }
    const timer = setTimeout(() => setOffline(true), graceMs)
    return () => clearTimeout(timer)
  }, [connected, graceMs, suspended])
  return offline
}

interface ReleaseOptions { finished?: boolean; hiddenIdleMs?: number; settleMs?: number }

/**
 * Hands the connection back while nobody is looking at it.
 *
 * The Spark plan caps the whole service at 100 simultaneous connections, and a
 * dropped client's socket is only reclaimed by Firebase's own timeout — we
 * cannot close someone else's. Releasing the connections we can account for is
 * the only lever that widens the margin.
 *
 * Callers holding presence must re-arm it on reconnect: releasing the socket
 * fires the server-side onDisconnect, exactly as a real drop would.
 */
export const useReleaseIdleConnection = (
  database: Database,
  { finished = false, hiddenIdleMs = HIDDEN_IDLE_MS, settleMs = ENDED_SETTLE_MS }: ReleaseOptions = {},
): boolean => {
  const [suspended, setSuspended] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const release = () => { goOffline(database); setSuspended(true) }
    // The Database is a singleton, so leaving it offline would break whichever
    // screen the student opens next.
    const restore = () => { clearTimeout(timer); goOnline(database); setSuspended(false) }

    if (finished) {
      timer = setTimeout(release, settleMs)
      // A finished market has nothing left to stream, so returning to the tab
      // must not reopen the connection.
      return restore
    }

    const onVisibilityChange = () => {
      clearTimeout(timer)
      if (document.visibilityState === 'hidden') timer = setTimeout(release, hiddenIdleMs)
      else restore()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    onVisibilityChange()
    return () => { document.removeEventListener('visibilitychange', onVisibilityChange); restore() }
  }, [database, finished, hiddenIdleMs, settleMs])
  return suspended
}

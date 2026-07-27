import { useEffect, useState } from 'react'
import { onValue, ref, type Database } from 'firebase/database'

/** Long enough to ignore the normal reconnect blips of a school network. */
export const OFFLINE_GRACE_MS = 12_000

/**
 * Reports a sustained loss of the Realtime Database connection.
 *
 * The listeners elsewhere only report permission errors. A refused connection —
 * the shape a Spark-plan concurrent-connection limit takes — never reaches them,
 * so the screen would otherwise sit on "connecting" forever with no explanation.
 */
export const useDatabaseOffline = (database: Database, graceMs = OFFLINE_GRACE_MS): boolean => {
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = onValue(ref(database, '.info/connected'), (snapshot) => {
      clearTimeout(timer)
      if (snapshot.val() === true) return setOffline(false)
      timer = setTimeout(() => setOffline(true), graceMs)
    })
    return () => { clearTimeout(timer); stop() }
  }, [database, graceMs])
  return offline
}

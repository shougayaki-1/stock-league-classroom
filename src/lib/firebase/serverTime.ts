import { onValue, ref, type Database } from 'firebase/database'

/**
 * Every host decision — lease expiry, phase progress, finalization checkpoints —
 * is keyed on a millisecond timestamp. A teacher laptop whose clock is minutes
 * off would expire its own lease or jump the price schedule, so all of it runs
 * on the RTDB server clock instead.
 */
let offsetMillis = 0

export const setServerTimeOffset = (value: number) => { offsetMillis = value }
export const serverNow = () => Date.now() + offsetMillis

export const startServerTimeSync = (database: Database) =>
  onValue(ref(database, '.info/serverTimeOffset'), (snapshot) => setServerTimeOffset(Number(snapshot.val() ?? 0)))

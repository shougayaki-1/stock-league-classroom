import { connectAuthEmulator, type Auth } from 'firebase/auth'
import { connectDatabaseEmulator, type Database } from 'firebase/database'
import { connectFirestoreEmulator, type Firestore } from 'firebase/firestore'

export const shouldUseEmulators = (env: Record<string, string | undefined>): boolean => env.VITE_USE_EMULATORS === 'true'
export const connectToEmulators = (auth: Auth, firestore: Firestore, database: Database): void => {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true })
  connectFirestoreEmulator(firestore, 'localhost', 8080)
  connectDatabaseEmulator(database, 'localhost', 9000)
}

import { connectAuthEmulator, type Auth } from 'firebase/auth'
import { connectDatabaseEmulator, type Database } from 'firebase/database'
import { connectFirestoreEmulator, type Firestore } from 'firebase/firestore'
import { connectFunctionsEmulator, type Functions } from 'firebase/functions'
import { connectStorageEmulator, type FirebaseStorage } from 'firebase/storage'

export const shouldUseEmulators = (env: Record<string, string | boolean | undefined>): boolean => env.VITE_USE_EMULATORS === 'true'
export const connectToEmulators = (auth: Auth, firestore: Firestore, database: Database, functions: Functions, storage: FirebaseStorage): void => {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true })
  connectFirestoreEmulator(firestore, 'localhost', 8080)
  connectDatabaseEmulator(database, 'localhost', 9000)
  connectFunctionsEmulator(functions, 'localhost', 5001)
  connectStorageEmulator(storage, 'localhost', 9199)
}

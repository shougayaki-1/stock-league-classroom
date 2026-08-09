import type { AppCheck } from 'firebase/app-check'
import type { FirebaseApp } from 'firebase/app'
import type { Auth } from 'firebase/auth'
import type { Database } from 'firebase/database'
import type { Firestore } from 'firebase/firestore'
import type { Functions } from 'firebase/functions'
import type { FirebaseStorage } from 'firebase/storage'
import { getFirebaseApp, getFirebaseAuth, getFirestoreDb, getRealtimeDb, getFunctionsService, getStorageService } from './firebaseConfig'
import { initializeAppCheck } from './appCheck'
import { connectToEmulators, shouldUseEmulators } from './useEmulators'
import { startServerTimeSync } from './serverTime'

export interface FirebaseServices { app: FirebaseApp; auth: Auth; firestore: Firestore; database: Database; functions: Functions; storage: FirebaseStorage; appCheck?: AppCheck }
export interface FirebaseBootstrapDependencies {
  getServices: () => Omit<FirebaseServices, 'appCheck'>
  connectToEmulators: (auth: Auth, firestore: Firestore, database: Database, functions: Functions, storage: FirebaseStorage) => void
  initializeAppCheck: (app: FirebaseApp, env: Record<string, string | boolean | undefined>) => AppCheck | undefined
  /** Optional so unit tests that pass a fake `Database` object need not supply a real RTDB listener. */
  startServerTimeSync?: (database: Database) => () => void
}
const defaultDependencies: FirebaseBootstrapDependencies = {
  getServices: () => ({ app: getFirebaseApp(), auth: getFirebaseAuth(), firestore: getFirestoreDb(), database: getRealtimeDb(), functions: getFunctionsService(), storage: getStorageService() }),
  connectToEmulators,
  initializeAppCheck,
  startServerTimeSync,
}

/** Creates an idempotent, render-boundary-safe Firebase service bootstrapper. */
export const createFirebaseBootstrapper = (dependencies: FirebaseBootstrapDependencies = defaultDependencies) => {
  let initialized: FirebaseServices | undefined
  return (env: Record<string, string | boolean | undefined> = import.meta.env): FirebaseServices => {
    if (initialized) return initialized
    const services = dependencies.getServices()
    if (shouldUseEmulators(env)) dependencies.connectToEmulators(services.auth, services.firestore, services.database, services.functions, services.storage)
    initialized = { ...services, appCheck: dependencies.initializeAppCheck(services.app, env) }
    dependencies.startServerTimeSync?.(initialized.database)
    return initialized
  }
}
export const bootstrapFirebase = createFirebaseBootstrapper()

import { initializeApp } from 'firebase-admin/app'

initializeApp()

export { ping } from './ping'
export { ensurePersonalOrgCallable } from './organizations/onCall'

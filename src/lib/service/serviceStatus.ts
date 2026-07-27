import { doc, getDoc, type Firestore } from 'firebase/firestore'

export interface ServiceStatus {
  acceptingNewMarkets: boolean
  message: string
}

export const SERVICE_STATUS_PATH = { collection: 'serviceStatus', document: 'global' } as const

/**
 * The switch is enforced in firestore.rules and database.rules.json, not here.
 * This read only lets the UI explain the refusal instead of showing a bare error.
 *
 * An absent document means "open", so that deploying the rules before seeding
 * the document cannot take the service down.
 */
export const readServiceStatus = async (firestore: Firestore): Promise<ServiceStatus> => {
  try {
    const snapshot = await getDoc(doc(firestore, SERVICE_STATUS_PATH.collection, SERVICE_STATUS_PATH.document))
    const data = snapshot.data()
    if (!data) return { acceptingNewMarkets: true, message: '' }
    return {
      acceptingNewMarkets: data.acceptingNewMarkets !== false,
      message: typeof data.message === 'string' ? data.message : '',
    }
  } catch {
    // A failed read must not block a teacher whose classroom is about to start.
    return { acceptingNewMarkets: true, message: '' }
  }
}

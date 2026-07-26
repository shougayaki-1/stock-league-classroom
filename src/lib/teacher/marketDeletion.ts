import { collection, deleteDoc, doc, getDoc, getDocs, type Firestore } from 'firebase/firestore'
import { ref, remove, type Database } from 'firebase/database'

const DAY_MS = 24 * 60 * 60 * 1000

/** True once `thresholdDays` have elapsed since the market was created. Purely informational for the UI. */
export const isDeleteRecommended = (
  market: { createdAt: { toMillis(): number } },
  nowMillis: number,
  thresholdDays = 30
): boolean => nowMillis - market.createdAt.toMillis() >= thresholdDays * DAY_MS

/**
 * Deletes a market and everything tied to it, always immediately (teacher-initiated deletion always
 * wins over the 30-day recommendation window; there is no extra guard here for "too soon").
 *
 * Order matters: `marketResults/{marketId}/participants/*` docs must be deleted before the
 * `markets/{marketId}` doc, because the result docs' delete rule looks up the live market doc
 * (`get(/databases/$(database)/documents/markets/$(marketId)).data.ownerUid == request.auth.uid`) to
 * authorize each delete. Once the market doc is gone, that lookup returns a non-existent document and
 * every remaining result-doc delete is denied.
 *
 * The market record stores its immutable join code, so the capability document is removed without
 * ever listing the otherwise-unlistable marketJoinCodes collection.
 */
export const deleteMarketCompletely = async (
  firestore: Firestore,
  rtdb: Database,
  marketId: string
): Promise<void> => {
  const marketRef = doc(firestore, 'markets', marketId)
  const market = await getDoc(marketRef)
  if (!market.exists()) return
  const joinCode = typeof market.data().joinCode === 'string' ? market.data().joinCode : ''
  const participantsSnapshot = await getDocs(collection(firestore, 'marketResults', marketId, 'participants'))
  const teamsSnapshot = await getDocs(collection(firestore, 'marketResults', marketId, 'teams'))
  await Promise.all([...participantsSnapshot.docs, ...teamsSnapshot.docs].map((resultDoc) => deleteDoc(resultDoc.ref)))

  await remove(ref(rtdb, `liveMarkets/${marketId}`))
  if (joinCode) await deleteDoc(doc(firestore, 'marketJoinCodes', joinCode))
  await deleteDoc(marketRef)
}

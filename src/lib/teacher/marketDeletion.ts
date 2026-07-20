import { collection, deleteDoc, doc, getDocs, type Firestore } from 'firebase/firestore'
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
 * Known gap: `marketJoinCodes/{code}` docs are not cleaned up here (no reverse index from market to
 * join code, and `marketJoinCodes` disallows `list` entirely) — a deleted market's join code becomes a
 * harmless dead end, not a security issue. See task-8-report.md for detail.
 */
export const deleteMarketCompletely = async (
  firestore: Firestore,
  rtdb: Database,
  marketId: string
): Promise<void> => {
  const participantsSnapshot = await getDocs(collection(firestore, 'marketResults', marketId, 'participants'))
  for (const participantDoc of participantsSnapshot.docs) await deleteDoc(participantDoc.ref)

  await deleteDoc(doc(firestore, 'markets', marketId))

  await remove(ref(rtdb, `liveMarkets/${marketId}`))
}

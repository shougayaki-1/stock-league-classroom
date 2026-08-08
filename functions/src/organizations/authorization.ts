import { HttpsError } from 'firebase-functions/v2/https'
import type { Firestore } from 'firebase-admin/firestore'

export interface ActiveMembership {
  role: 'owner' | 'admin' | 'teacher'
  membershipVersion: number
}

/**
 * Shared Callable guard: run this before any Admin SDK work in a Callable
 * that acts within an organization (future run creation, restore, and
 * privacy Callables). Firestore is the system of record for membership
 * status, so this reads it directly rather than the RTDB mirror.
 */
export const requireActiveOrgMember = async (
  firestore: Firestore,
  orgId: string,
  uid: string,
): Promise<ActiveMembership> => {
  const snap = await firestore.doc(`organizations/${orgId}/members/${uid}`).get()
  if (!snap.exists || snap.get('status') !== 'active') {
    throw new HttpsError('permission-denied', '有効な組織メンバーではありません。')
  }
  return { role: snap.get('role'), membershipVersion: snap.get('membershipVersion') }
}

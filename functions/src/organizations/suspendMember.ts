import { getDatabase } from 'firebase-admin/database'
import { getFirestore } from 'firebase-admin/firestore'
import { syncOrganizationMembershipChange, type MembershipChange } from './membershipSync'
import { quotaReservationDocumentPath } from './parentOrgQuotaFirestore'

interface MemberSnapshot {
  role: 'owner' | 'admin' | 'teacher'
  status: 'active' | 'suspended'
  membershipVersion: number
}

export interface SuspendOrgMemberDeps {
  getMember: (orgId: string, uid: string) => Promise<MemberSnapshot | null>
  countActiveOwners: (orgId: string) => Promise<number>
  syncMembership: (change: MembershipChange) => Promise<void>
  releaseTeacherSeat?: (orgId: string, uid: string, expectedMembershipVersion: number) => Promise<void>
  nowSeconds: () => number
}

export interface SuspendOrgMemberInput { orgId: string; uid: string }

/** Suspends a member while preserving the last active owner. */
export const suspendOrgMember = async (
  deps: SuspendOrgMemberDeps,
  input: SuspendOrgMemberInput,
): Promise<void> => {
  const member = await deps.getMember(input.orgId, input.uid)
  if (!member) throw new Error('このメンバーは既に解除されています')
  if (member.status === 'suspended') {
    if (member.role === 'teacher' && deps.releaseTeacherSeat) {
      await deps.releaseTeacherSeat(input.orgId, input.uid, member.membershipVersion)
    }
    throw new Error('このメンバーは既に解除されています')
  }

  if (member.role === 'owner' && await deps.countActiveOwners(input.orgId) <= 1) {
    throw new Error('組織には少なくとも1人のownerが必要です')
  }

  await deps.syncMembership({
    orgId: input.orgId,
    uid: input.uid,
    role: member.role,
    status: 'suspended',
    membershipVersion: member.membershipVersion + 1,
    revokedAtSeconds: deps.nowSeconds(),
  })
  if (member.role === 'teacher' && deps.releaseTeacherSeat) {
    await deps.releaseTeacherSeat(input.orgId, input.uid, member.membershipVersion + 1)
  }
}

export interface ReleaseTeacherSeatTransaction {
  get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  delete: (path: string) => void
}

export interface ReleaseTeacherSeatReservationDeps {
  firestore: {
    runTransaction: (operation: (transaction: ReleaseTeacherSeatTransaction) => Promise<void>) => Promise<void>
  }
}

export interface ReleaseTeacherSeatReservationInput {
  schoolOrgId: string
  teacherUid: string
  expectedMembershipVersion: number
}

export const releaseTeacherSeatReservation = async (
  deps: ReleaseTeacherSeatReservationDeps,
  input: ReleaseTeacherSeatReservationInput,
): Promise<void> => {
  await deps.firestore.runTransaction(async (transaction) => {
    const memberPath = `organizations/${input.schoolOrgId}/members/${input.teacherUid}`
    const schoolPath = `organizations/${input.schoolOrgId}`
    const memberSnapshot = await transaction.get(memberPath)
    const member = memberSnapshot.data()
    if (!memberSnapshot.exists
      || member?.role !== 'teacher'
      || member.status !== 'suspended'
      || member.membershipVersion !== input.expectedMembershipVersion) return

    const schoolSnapshot = await transaction.get(schoolPath)
    const parentOrgId = schoolSnapshot.data()?.parentOrgId
    if (!schoolSnapshot.exists || schoolSnapshot.data()?.type !== 'school'
      || typeof parentOrgId !== 'string' || parentOrgId.length === 0) return

    const reservationPath = quotaReservationDocumentPath(
      parentOrgId,
      'teacherSeats',
      input.schoolOrgId,
      input.teacherUid,
    )
    const reservationSnapshot = await transaction.get(reservationPath)
    if (reservationSnapshot.exists) transaction.delete(reservationPath)
  })
}

/** Production wiring: Firestore Admin SDK and the RTDB membership mirror. */
export const suspendOrgMemberWithAdminSdk = (input: SuspendOrgMemberInput): Promise<void> => {
  const db = getFirestore()
  return suspendOrgMember({
    getMember: async (orgId, uid) => {
      const snap = await db.doc(`organizations/${orgId}/members/${uid}`).get()
      return snap.exists ? (snap.data() as MemberSnapshot) : null
    },
    countActiveOwners: async (orgId) => {
      const snap = await db.collection(`organizations/${orgId}/members`)
        .where('role', '==', 'owner')
        .where('status', '==', 'active')
        .get()
      return snap.size
    },
    syncMembership: (change) => syncOrganizationMembershipChange({
      markMirrorPending: async (orgId, membershipVersion) => {
        await getDatabase().ref(`orgAccessMeta/${orgId}/${change.uid}`)
          .set({ syncState: 'PENDING', membershipVersion })
      },
      updateFirestoreMembership: async (membership) => {
        await db.doc(`organizations/${membership.orgId}/members/${membership.uid}`).set({
          role: membership.role,
          status: membership.status,
          membershipVersion: membership.membershipVersion,
        }, { merge: true })
      },
      commitMirrorSynced: async (membership) => {
        await getDatabase().ref().update({
          [`orgAccess/${membership.orgId}/${membership.uid}`]: {
            role: membership.role,
            status: membership.status,
            membershipVersion: membership.membershipVersion,
            revokedAtSeconds: membership.revokedAtSeconds,
          },
          [`orgAccessMeta/${membership.orgId}/${membership.uid}`]: { syncState: 'SYNCED' },
        })
      },
    }, change),
    releaseTeacherSeat: (orgId, uid, expectedMembershipVersion) => releaseTeacherSeatReservation({
      firestore: {
        runTransaction: (operation) => db.runTransaction((transaction) => operation({
          get: async (path) => {
            const snapshot = await transaction.get(db.doc(path))
            return { exists: snapshot.exists, data: () => snapshot.data() }
          },
          delete: (path) => { transaction.delete(db.doc(path)) },
        })),
      },
    }, { schoolOrgId: orgId, teacherUid: uid, expectedMembershipVersion }),
    nowSeconds: () => Math.floor(Date.now() / 1000),
  }, input)
}

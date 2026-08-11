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
  releaseTeacherSeat?: (orgId: string, uid: string) => Promise<void>
  nowSeconds: () => number
}

export interface SuspendOrgMemberInput { orgId: string; uid: string }

/** Suspends a member while preserving the last active owner. */
export const suspendOrgMember = async (
  deps: SuspendOrgMemberDeps,
  input: SuspendOrgMemberInput,
): Promise<void> => {
  const member = await deps.getMember(input.orgId, input.uid)
  if (!member || member.status !== 'active') throw new Error('このメンバーは既に解除されています')

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
    await deps.releaseTeacherSeat(input.orgId, input.uid)
  }
}

export interface ReleaseTeacherSeatReservationDeps {
  getParentOrgId: (schoolOrgId: string) => Promise<string | null>
  deleteReservation: (path: string) => Promise<void>
}

export interface ReleaseTeacherSeatReservationInput {
  schoolOrgId: string
  teacherUid: string
}

export const releaseTeacherSeatReservation = async (
  deps: ReleaseTeacherSeatReservationDeps,
  input: ReleaseTeacherSeatReservationInput,
): Promise<void> => {
  const parentOrgId = await deps.getParentOrgId(input.schoolOrgId)
  if (!parentOrgId) return
  await deps.deleteReservation(quotaReservationDocumentPath(
    parentOrgId,
    'teacherSeats',
    input.schoolOrgId,
    input.teacherUid,
  ))
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
    releaseTeacherSeat: (orgId, uid) => releaseTeacherSeatReservation({
      getParentOrgId: async (schoolOrgId) => {
        const snapshot = await db.doc(`organizations/${schoolOrgId}`).get()
        const parentOrgId = snapshot.get('parentOrgId') as unknown
        return typeof parentOrgId === 'string' && parentOrgId.length > 0 ? parentOrgId : null
      },
      deleteReservation: async (path) => { await db.doc(path).delete() },
    }, { schoolOrgId: orgId, teacherUid: uid }),
    nowSeconds: () => Math.floor(Date.now() / 1000),
  }, input)
}

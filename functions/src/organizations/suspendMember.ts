import { getDatabase } from 'firebase-admin/database'
import { getFirestore } from 'firebase-admin/firestore'
import { syncOrganizationMembershipChange, type MembershipChange } from './membershipSync'

interface MemberSnapshot {
  role: 'owner' | 'admin' | 'teacher'
  status: 'active' | 'suspended'
  membershipVersion: number
}

export interface SuspendOrgMemberDeps {
  getMember: (orgId: string, uid: string) => Promise<MemberSnapshot | null>
  countActiveOwners: (orgId: string) => Promise<number>
  syncMembership: (change: MembershipChange) => Promise<void>
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
    nowSeconds: () => Math.floor(Date.now() / 1000),
  }, input)
}

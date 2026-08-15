import { getFirestore } from 'firebase-admin/firestore'
import { getDatabase } from 'firebase-admin/database'
import { syncOrganizationMembershipChange, type MembershipChange } from './membershipSync'

interface MemberSnapshot {
  role: 'owner' | 'admin' | 'teacher'
  status: 'active' | 'suspended'
  membershipVersion: number
}

export interface ChangeOrgMemberRoleDeps {
  getMember: (orgId: string, uid: string) => Promise<MemberSnapshot | null>
  countActiveOwners: (orgId: string) => Promise<number>
  syncMembership: (change: MembershipChange) => Promise<void>
}

export interface ChangeOrgMemberRoleInput {
  orgId: string
  uid: string
  newRole: 'owner' | 'admin' | 'teacher'
}

/** Reuses syncOrganizationMembershipChange — the single function all grant/suspend/role-change flows go through. */
export const changeOrgMemberRole = async (deps: ChangeOrgMemberRoleDeps, input: ChangeOrgMemberRoleInput): Promise<void> => {
  const member = await deps.getMember(input.orgId, input.uid)
  if (!member) throw new Error('このメンバーは見つかりません')
  if (member.status !== 'active') throw new Error('解除されたメンバーのロールは変更できません')

  if (member.role === 'owner' && input.newRole !== 'owner' && await deps.countActiveOwners(input.orgId) <= 1) {
    throw new Error('組織には少なくとも1人のownerが必要です')
  }

  await deps.syncMembership({
    orgId: input.orgId,
    uid: input.uid,
    role: input.newRole,
    status: 'active',
    membershipVersion: member.membershipVersion + 1,
    revokedAtSeconds: 0,
  })
}

/** Production wiring: Firestore Admin SDK and the RTDB membership mirror (same shape as suspendOrgMemberWithAdminSdk). */
export const changeOrgMemberRoleWithAdminSdk = (input: ChangeOrgMemberRoleInput): Promise<void> => {
  const db = getFirestore()
  return changeOrgMemberRole({
    getMember: async (orgId, uid) => {
      const snap = await db.doc(`organizations/${orgId}/members/${uid}`).get()
      return snap.exists ? (snap.data() as MemberSnapshot) : null
    },
    countActiveOwners: async (orgId) => {
      const snap = await db.collection(`organizations/${orgId}/members`)
        .where('role', '==', 'owner').where('status', '==', 'active')
        .get()
      return snap.size
    },
    syncMembership: (change) => syncOrganizationMembershipChange({
      markMirrorPending: async (orgId, membershipVersion) => {
        await getDatabase().ref(`orgAccessMeta/${orgId}/${change.uid}`).set({ syncState: 'PENDING', membershipVersion })
      },
      updateFirestoreMembership: async (membership) => {
        await db.doc(`organizations/${membership.orgId}/members/${membership.uid}`).set({
          role: membership.role, status: membership.status, membershipVersion: membership.membershipVersion,
        }, { merge: true })
      },
      commitMirrorSynced: async (membership) => {
        await getDatabase().ref().update({
          [`orgAccess/${membership.orgId}/${membership.uid}`]: {
            role: membership.role, status: membership.status, membershipVersion: membership.membershipVersion, revokedAtSeconds: membership.revokedAtSeconds,
          },
          [`orgAccessMeta/${membership.orgId}/${membership.uid}`]: { syncState: 'SYNCED' },
        })
      },
    }, change),
  }, input)
}

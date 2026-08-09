import { getDatabase } from 'firebase-admin/database'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { syncOrganizationMembershipChange, type MembershipChange } from './membershipSync'

export interface Invitation {
  id: string
  orgId: string
  email: string
  role: 'admin' | 'teacher'
  status: 'PENDING' | 'ACCEPTED'
  invitedByUid: string
  createdAt: unknown
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase()

export interface PendingInvitationData {
  email: string
  role: 'admin' | 'teacher'
  status: 'PENDING'
  invitedByUid: string
  createdAt: unknown
}

export interface CreateInvitationDeps {
  findPendingInvitation: (orgId: string, email: string) => Promise<Invitation | null>
  createInvitationDoc: (orgId: string, data: PendingInvitationData) => Promise<string>
  /**
   * Optional atomic production adapter. The pure fallback stays available for
   * unit tests and alternate stores that provide their own duplicate control.
   */
  reservePendingInvitation?: (orgId: string, data: PendingInvitationData) => Promise<string>
  now?: () => unknown
}

export interface CreateInvitationInput {
  orgId: string
  email: string
  role: 'admin' | 'teacher'
  invitedByUid: string
}

export const createInvitation = async (
  deps: CreateInvitationDeps,
  input: CreateInvitationInput,
): Promise<{ invitationId: string }> => {
  const email = normalizeEmail(input.email)
  const data: PendingInvitationData = {
    email,
    role: input.role,
    status: 'PENDING',
    invitedByUid: input.invitedByUid,
    createdAt: deps.now ? deps.now() : new Date().toISOString(),
  }
  if (deps.reservePendingInvitation) {
    return { invitationId: await deps.reservePendingInvitation(input.orgId, data) }
  }

  const existing = await deps.findPendingInvitation(input.orgId, email)
  if (existing) return { invitationId: existing.id }
  const invitationId = await deps.createInvitationDoc(input.orgId, data)
  return { invitationId }
}

/** Production wiring: Firestore Admin SDK. */
export const createInvitationWithAdminSdk = (
  input: CreateInvitationInput,
): Promise<{ invitationId: string }> => {
  const db = getFirestore()
  return createInvitation({
    reservePendingInvitation: async (orgId, data) => {
      const invitationId = `email:${encodeURIComponent(data.email)}`
      const ref = db.doc(`organizations/${orgId}/invitations/${invitationId}`)
      const pendingForEmail = db.collection(`organizations/${orgId}/invitations`)
        .where('email', '==', data.email)
        .where('status', '==', 'PENDING')
        .limit(1)
      return db.runTransaction(async (transaction) => {
        const pending = await transaction.get(pendingForEmail)
        if (!pending.empty) return pending.docs[0].id

        const existing = await transaction.get(ref)
        if (existing.exists && existing.get('status') === 'PENDING') return ref.id

        const invitation = { ...data, createdAt: FieldValue.serverTimestamp() }
        if (existing.exists) transaction.set(ref, invitation)
        else transaction.create(ref, invitation)
        return ref.id
      })
    },
    findPendingInvitation: async (orgId, email) => {
      const snap = await db.collection(`organizations/${orgId}/invitations`)
        .where('email', '==', email)
        .where('status', '==', 'PENDING')
        .limit(1)
        .get()
      if (snap.empty) return null
      const doc = snap.docs[0]
      return { id: doc.id, orgId, ...(doc.data() as Omit<Invitation, 'id' | 'orgId'>) }
    },
    createInvitationDoc: async (orgId, data) => {
      const ref = await db.collection(`organizations/${orgId}/invitations`).add({
        ...data,
        createdAt: FieldValue.serverTimestamp(),
      })
      return ref.id
    },
  }, input)
}

export interface AcceptInvitationDeps {
  getInvitation: (orgId: string, invitationId: string) => Promise<Invitation | null>
  getMembership: (orgId: string, uid: string) => Promise<{ status: string } | null>
  syncMembership: (change: MembershipChange) => Promise<void>
  markInvitationAccepted: (orgId: string, invitationId: string) => Promise<void>
}

export interface AcceptInvitationInput {
  orgId: string
  invitationId: string
  callerUid: string
  callerEmail: string
}

/**
 * Active members retain their existing role: this avoids an invitation
 * silently promoting or demoting a member. The invitation is still accepted
 * so a stale re-sent invitation is not left in the recipient's list.
 */
export const acceptInvitation = async (
  deps: AcceptInvitationDeps,
  input: AcceptInvitationInput,
): Promise<{ status: 'ACCEPTED' | 'ALREADY_MEMBER' }> => {
  const invitation = await deps.getInvitation(input.orgId, input.invitationId)
  if (!invitation || invitation.status !== 'PENDING') {
    throw new Error('この招待は既に処理されています')
  }
  if (normalizeEmail(invitation.email) !== normalizeEmail(input.callerEmail)) {
    throw new Error('あなた宛の招待ではありません')
  }

  const membership = await deps.getMembership(input.orgId, input.callerUid)
  const alreadyActive = membership?.status === 'active'
  if (!alreadyActive) {
    await deps.syncMembership({
      orgId: input.orgId,
      uid: input.callerUid,
      role: invitation.role,
      status: 'active',
      membershipVersion: 1,
      revokedAtSeconds: 0,
    })
  }
  await deps.markInvitationAccepted(input.orgId, input.invitationId)
  return { status: alreadyActive ? 'ALREADY_MEMBER' : 'ACCEPTED' }
}

/** Production wiring: Firestore Admin SDK plus the canonical membership sync. */
export const acceptInvitationWithAdminSdk = (
  input: AcceptInvitationInput,
): Promise<{ status: 'ACCEPTED' | 'ALREADY_MEMBER' }> => {
  const db = getFirestore()
  return acceptInvitation({
    getInvitation: async (orgId, invitationId) => {
      const snap = await db.doc(`organizations/${orgId}/invitations/${invitationId}`).get()
      if (!snap.exists) return null
      return { id: snap.id, orgId, ...(snap.data() as Omit<Invitation, 'id' | 'orgId'>) }
    },
    getMembership: async (orgId, uid) => {
      const snap = await db.doc(`organizations/${orgId}/members/${uid}`).get()
      return snap.exists ? { status: snap.get('status') as string } : null
    },
    syncMembership: (change) => syncOrganizationMembershipChange({
      markMirrorPending: async (orgId, membershipVersion) => {
        await getDatabase().ref(`orgAccessMeta/${orgId}/${change.uid}`).set({
          syncState: 'PENDING',
          membershipVersion,
        })
      },
      updateFirestoreMembership: async (membership) => {
        await db.doc(`organizations/${membership.orgId}/members/${membership.uid}`).set({
          role: membership.role,
          status: membership.status,
          membershipVersion: membership.membershipVersion,
          joinedAt: FieldValue.serverTimestamp(),
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
    markInvitationAccepted: async (orgId, invitationId) => {
      await db.doc(`organizations/${orgId}/invitations/${invitationId}`).update({
        status: 'ACCEPTED',
      })
    },
  }, input)
}

export interface ListMyInvitationsDeps {
  queryPendingInvitationsByEmail: (email: string) => Promise<Invitation[]>
}

export interface ListMyInvitationsInput {
  email: string
}

export const listMyInvitations = (
  deps: ListMyInvitationsDeps,
  input: ListMyInvitationsInput,
): Promise<Invitation[]> => deps.queryPendingInvitationsByEmail(normalizeEmail(input.email))

/** Production wiring: Firestore collection-group query across organization invitations. */
export const listMyInvitationsWithAdminSdk = (
  input: ListMyInvitationsInput,
): Promise<Invitation[]> => {
  const db = getFirestore()
  return listMyInvitations({
    queryPendingInvitationsByEmail: async (email) => {
      const snap = await db.collectionGroup('invitations')
        .where('email', '==', email)
        .where('status', '==', 'PENDING')
        .get()
      return snap.docs.map((doc) => ({
        id: doc.id,
        orgId: doc.ref.parent.parent!.id,
        ...(doc.data() as Omit<Invitation, 'id' | 'orgId'>),
      }))
    },
  }, input)
}

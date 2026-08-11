import { getDatabase } from 'firebase-admin/database'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { syncOrganizationMembershipChange, type MembershipChange } from './membershipSync'
import { canIncreaseLimitedResource, type DowngradeStatus } from './downgradeEnforcement'
import { reserveSharedQuota } from './parentOrgQuota'
import {
  allocationFromQuotaDocument,
  quotaReservationDocumentPath,
  reservationFromQuotaDocument,
  type QuotaDocument,
} from './parentOrgQuotaFirestore'
import { getDowngradeStatusWithAdminSdk } from './planLimits'

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
  getMembership: (orgId: string, uid: string) => Promise<{
    status: string
    pendingMembershipSyncInvitationId?: string
  } | null>
  getDowngradeStatus?: (orgId: string) => Promise<DowngradeStatus>
  reserveTeacherSeat?: (orgId: string, uid: string, invitationId: string) => Promise<{ alreadyActive: boolean }>
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
  let alreadyActive = membership?.status === 'active'
  const admissionNeedsSync = membership?.status === 'active'
    && invitation.role === 'teacher'
    && membership.pendingMembershipSyncInvitationId === input.invitationId
  let shouldSync = admissionNeedsSync
  if (!alreadyActive) {
    if (invitation.role === 'teacher' && deps.getDowngradeStatus) {
      const status = await deps.getDowngradeStatus(input.orgId)
      if (!canIncreaseLimitedResource(status, 'teacherSeats')) {
        throw new Error('教師席を整理する必要があります')
      }
    }
    if (invitation.role === 'teacher' && deps.reserveTeacherSeat) {
      alreadyActive = (await deps.reserveTeacherSeat(
        input.orgId,
        input.callerUid,
        input.invitationId,
      )).alreadyActive
    }
    if (!alreadyActive) {
      shouldSync = true
    }
  }
  if (shouldSync) {
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
  return { status: alreadyActive && !admissionNeedsSync ? 'ALREADY_MEMBER' : 'ACCEPTED' }
}

export interface TeacherSeatQuotaTransaction {
  get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  getCollection: (path: string) => Promise<QuotaDocument[]>
  countActiveTeachers: (orgId: string) => Promise<number>
  set: (path: string, data: Record<string, unknown>, options?: { merge: boolean }) => void
}

export interface ReserveTeacherSeatForInvitationDeps {
  firestore: {
    runTransaction: (
      operation: (transaction: TeacherSeatQuotaTransaction) => Promise<{ alreadyActive: boolean }>,
    ) => Promise<{ alreadyActive: boolean }>
  }
  now?: () => unknown
}

export interface ReserveTeacherSeatForInvitationInput {
  schoolOrgId: string
  teacherUid: string
  pendingMembershipSyncInvitationId?: string
}

export const reserveTeacherSeatForInvitation = (
  deps: ReserveTeacherSeatForInvitationDeps,
  input: ReserveTeacherSeatForInvitationInput,
): Promise<{ alreadyActive: boolean }> => {
  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  return deps.firestore.runTransaction(async (transaction) => {
    const schoolPath = `organizations/${input.schoolOrgId}`
    const memberPath = `${schoolPath}/members/${input.teacherUid}`
    const [schoolSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(schoolPath),
      transaction.get(memberPath),
    ])
    const member = memberSnapshot.data()
    if (memberSnapshot.exists && member?.status === 'active') return { alreadyActive: true }

    const school = schoolSnapshot.data()
    const parentOrgId = school?.parentOrgId
    if (school?.type !== 'school' || typeof parentOrgId !== 'string' || parentOrgId.length === 0) {
      return { alreadyActive: false }
    }

    const allocationPath = `organizations/${parentOrgId}/schoolAllocations/${input.schoolOrgId}`
    const [allocationSnapshot, activeTeachers] = await Promise.all([
      transaction.get(allocationPath),
      transaction.countActiveTeachers(input.schoolOrgId),
    ])
    if (!allocationSnapshot.exists) throw new Error('この学校の配分が見つかりません')
    const allocation = allocationFromQuotaDocument({
      id: input.schoolOrgId,
      data: () => allocationSnapshot.data() ?? {},
    })
    const currentUsage = activeTeachers + 1
    const activateTeacher = () => transaction.set(memberPath, {
      role: 'teacher',
      status: 'active',
      membershipVersion: 1,
      ...(input.pendingMembershipSyncInvitationId
        ? { pendingMembershipSyncInvitationId: input.pendingMembershipSyncInvitationId }
        : {}),
    }, { merge: true })
    if (currentUsage <= allocation.guaranteedTeacherSeats) {
      activateTeacher()
      return { alreadyActive: false }
    }

    const parentSnapshot = await transaction.get(`organizations/${parentOrgId}`)
    const parent = parentSnapshot.data()
    if (!parentSnapshot.exists || parent?.type !== 'parentOrg') throw new Error('上位組織が見つかりません')
    if (typeof parent.planId !== 'string') throw new Error('上位組織のプランが設定されていません')

    const [parentPlanSnapshot, allocationDocuments, reservationDocuments] = await Promise.all([
      transaction.get(`planDefinitions/${parent.planId}`),
      transaction.getCollection(`organizations/${parentOrgId}/schoolAllocations`),
      transaction.getCollection(`organizations/${parentOrgId}/quotaReservations`),
    ])
    if (!parentPlanSnapshot.exists) throw new Error('上位組織のプランが設定されていません')
    const parentLimit = (parentPlanSnapshot.data()?.limits as Record<string, unknown> | undefined)?.teacherSeats
    if (typeof parentLimit !== 'number') throw new Error('上位組織の利用上限が見つかりません')

    const allocations = allocationDocuments.map(allocationFromQuotaDocument)
    const reservations = reservationDocuments
      .map(reservationFromQuotaDocument)
      .filter((reservation): reservation is NonNullable<typeof reservation> => reservation !== null)
    const reservation = reserveSharedQuota({
      resourceKey: 'teacherSeats',
      parentLimit,
      allocations,
      reservations,
      schoolOrgId: input.schoolOrgId,
      targetId: input.teacherUid,
      currentUsage,
    })
    if (reservation && !reservations.some(({ reservationId }) => reservationId === reservation.reservationId)) {
      transaction.set(quotaReservationDocumentPath(
        parentOrgId,
        'teacherSeats',
        input.schoolOrgId,
        input.teacherUid,
      ), {
        ...reservation,
        createdAt: nowValue,
      })
    }
    activateTeacher()
    return { alreadyActive: false }
  })
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
      if (!snap.exists) return null
      const data = snap.data() ?? {}
      return {
        status: data.status as string,
        pendingMembershipSyncInvitationId: data.pendingMembershipSyncInvitationId as string | undefined,
      }
    },
    getDowngradeStatus: getDowngradeStatusWithAdminSdk,
    reserveTeacherSeat: (orgId, uid, invitationId) => reserveTeacherSeatForInvitation({
      firestore: {
        runTransaction: (operation) => db.runTransaction((transaction) => operation({
          get: async (path) => {
            const snapshot = await transaction.get(db.doc(path))
            return { exists: snapshot.exists, data: () => snapshot.data() }
          },
          getCollection: async (path) => {
            const snapshot = await transaction.get(db.collection(path))
            return snapshot.docs.map((document) => ({ id: document.id, data: () => document.data() }))
          },
          countActiveTeachers: async (schoolOrgId) => {
            const snapshot = await transaction.get(
              db.collection(`organizations/${schoolOrgId}/members`)
                .where('status', '==', 'active')
                .where('role', '==', 'teacher'),
            )
            return snapshot.size
          },
          set: (path, data, options) => {
            if (options) transaction.set(db.doc(path), data, options)
            else transaction.set(db.doc(path), data)
          },
        })),
      },
      now: FieldValue.serverTimestamp,
    }, {
      schoolOrgId: orgId,
      teacherUid: uid,
      pendingMembershipSyncInvitationId: invitationId,
    }),
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

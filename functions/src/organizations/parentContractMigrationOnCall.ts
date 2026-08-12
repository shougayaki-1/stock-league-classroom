import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { requireActiveOrgMember } from './authorization'
import {
  migrateSchoolFromEndedParent,
  type ParentContractMigrationDeps,
  type ParentContractMigrationPreconditions,
  type ParentContractReservation,
} from './parentContractMigration'
import { parentContractStateFrom } from './parentContract'

const callableOptions = { region: 'asia-northeast1' as const }

const requireTeacher = (request: CallableRequest): NonNullable<CallableRequest['auth']> => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (request.auth.token.email_verified !== true || request.auth.token.firebase?.sign_in_provider !== 'google.com') {
    throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  }
  return request.auth
}

const requireSchoolManager = (membership: { role: string }): void => {
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    throw new HttpsError('permission-denied', '学校組織のowner または admin である必要があります。')
  }
}

const migrationDepsWithAdminSdk = (db: Firestore): ParentContractMigrationDeps => ({
  readMigrationPreconditions: async (schoolOrgId): Promise<ParentContractMigrationPreconditions> => {
    const school = await db.doc(`organizations/${schoolOrgId}`).get()
    const schoolData = school.exists ? school.data() as Record<string, unknown> : null
    const parentOrgId = typeof schoolData?.parentOrgId === 'string' ? schoolData.parentOrgId : null
    const parent = parentOrgId ? await db.doc(`organizations/${parentOrgId}`).get() : null
    return {
      parentOrgId,
      school: schoolData,
      parent: parent?.exists ? parent.data() as Record<string, unknown> : null,
    }
  },
  listReservationPage: async (parentOrgId, schoolOrgId, limit): Promise<ParentContractReservation[]> => {
    const snapshot = await db.collection(`organizations/${parentOrgId}/quotaReservations`)
      .where('schoolOrgId', '==', schoolOrgId)
      .limit(limit)
      .get()
    return snapshot.docs.map((document) => ({ id: document.id }))
  },
  deleteReservationPage: async (parentOrgId, _schoolOrgId, reservations): Promise<void> => {
    const batch = db.batch()
    for (const reservation of reservations) {
      batch.delete(db.doc(`organizations/${parentOrgId}/quotaReservations/${reservation.id}`))
    }
    await batch.commit()
  },
  finalizeMigration: async ({ parentOrgId, schoolOrgId, migratedByUid, schoolSubscriptionId }): Promise<void> => {
    const parentRef = db.doc(`organizations/${parentOrgId}`)
    const schoolRef = db.doc(`organizations/${schoolOrgId}`)
    const allocationRef = db.doc(`organizations/${parentOrgId}/schoolAllocations/${schoolOrgId}`)
    const auditRef = db.doc(`organizations/${schoolOrgId}/parentContractMigrations/${parentOrgId}`)
    const reservationsQuery = db.collection(`organizations/${parentOrgId}/quotaReservations`)
      .where('schoolOrgId', '==', schoolOrgId)
      .limit(1)
    await db.runTransaction(async (transaction) => {
      const [parent, school, remainingReservations] = await Promise.all([
        transaction.get(parentRef),
        transaction.get(schoolRef),
        transaction.get(reservationsQuery),
      ])
      if (!parent.exists || parentContractStateFrom(parent.data()) !== 'ENDED') {
        throw new Error('親組織の契約が終了していないため移行できません')
      }
      const schoolData = school.exists ? school.data() as Record<string, unknown> : undefined
      const subscription = schoolData?.stripeSubscriptionState as { subscriptionId?: unknown; status?: unknown } | undefined
      if (
        !schoolData
        || schoolData.parentOrgId !== parentOrgId
        || subscription?.status !== 'active'
        || subscription.subscriptionId !== schoolSubscriptionId
      ) {
        throw new Error('学校の状態が変更されたため移行できません')
      }
      if (!remainingReservations.empty) throw new Error('共有枠の予約が残っているため移行できません')

      transaction.update(schoolRef, { parentOrgId: null })
      transaction.delete(allocationRef)
      transaction.set(auditRef, {
        parentOrgId,
        migratedByUid,
        migratedAt: FieldValue.serverTimestamp(),
        schoolSubscriptionId,
      })
    })
  },
})

export const migrateSchoolFromEndedParentWithAdminSdk = async (
  schoolOrgId: string,
  actorUid: string,
) => migrateSchoolFromEndedParent(migrationDepsWithAdminSdk(getFirestore()), { schoolOrgId, actorUid })

export const migrateSchoolFromEndedParentCallable = onCall(callableOptions, async (request) => {
  const auth = requireTeacher(request)
  const data = request.data as { schoolOrgId?: unknown }
  if (typeof data.schoolOrgId !== 'string' || data.schoolOrgId.length === 0) {
    throw new HttpsError('invalid-argument', 'schoolOrgId は必須です。')
  }
  requireSchoolManager(await requireActiveOrgMember(getFirestore(), data.schoolOrgId, auth.uid))
  try {
    return await migrateSchoolFromEndedParentWithAdminSdk(data.schoolOrgId, auth.uid)
  } catch (error) {
    if (error instanceof Error) throw new HttpsError('failed-precondition', error.message)
    throw error
  }
})

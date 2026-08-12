import { FieldValue, getFirestore, type Firestore, type Transaction } from 'firebase-admin/firestore'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { requireActiveOrgMember } from './authorization'
import {
  type QuotaReservation,
  type SchoolQuotaAllocation,
  validateAllocationChange,
} from './parentOrgQuota'
import { ACTIVE_LESSON_RUN_STATUSES } from './planLimits'
import { assertParentContractAllowsSharedQuota, parentContractStateFrom } from './parentContract'

const callableOptions = { region: 'asia-northeast1' as const }

const requireTeacher = (request: CallableRequest): NonNullable<CallableRequest['auth']> => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (request.auth.token.email_verified !== true || request.auth.token.firebase?.sign_in_provider !== 'google.com') {
    throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  }
  return request.auth
}

const requireManager = (membership: { role: string }): void => {
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    throw new HttpsError('permission-denied', '上位組織のowner または admin である必要があります。')
  }
}

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

const allocationFrom = (schoolOrgId: string, data: Record<string, unknown>): SchoolQuotaAllocation => ({
  schoolOrgId,
  guaranteedConcurrentLessonsAndMarkets: Number(data.guaranteedConcurrentLessonsAndMarkets ?? 0),
  guaranteedTeacherSeats: Number(data.guaranteedTeacherSeats ?? 0),
})

const reservationFrom = (reservationId: string, data: Record<string, unknown>): QuotaReservation | null => {
  const resourceKey = data.resourceKey
  if (resourceKey !== 'concurrentLessonsAndMarkets' && resourceKey !== 'teacherSeats') return null
  if (typeof data.schoolOrgId !== 'string' || typeof data.targetId !== 'string') return null
  return { reservationId, resourceKey, schoolOrgId: data.schoolOrgId, targetId: data.targetId }
}

const limitsFrom = (data: Record<string, unknown> | undefined): { concurrentLessonsAndMarkets: number; teacherSeats: number } => {
  const limits = data?.limits as Record<string, unknown> | undefined
  const concurrentLessonsAndMarkets = limits?.concurrentLessonsAndMarkets
  const teacherSeats = limits?.teacherSeats
  if (typeof concurrentLessonsAndMarkets !== 'number' || typeof teacherSeats !== 'number') {
    throw new Error('上位組織の利用上限が見つかりません')
  }
  return { concurrentLessonsAndMarkets, teacherSeats }
}

const loadPlanLimits = async (
  transaction: Transaction,
  db: Firestore,
  parentData: Record<string, unknown> | undefined,
) => {
  const planId = parentData?.planId
  if (typeof planId !== 'string') throw new Error('上位組織のプランが設定されていません')
  const snapshot = await transaction.get(db.doc(`planDefinitions/${planId}`))
  if (!snapshot.exists) throw new Error('上位組織のプランが設定されていません')
  return limitsFrom(snapshot.data())
}

const toFailedPrecondition = (error: unknown): never => {
  if (error instanceof HttpsError) throw error
  if (error instanceof Error) throw new HttpsError('failed-precondition', error.message)
  throw error
}

interface SetAllocationRequest {
  parentOrgId?: unknown
  schoolOrgId?: unknown
  guaranteedConcurrentLessonsAndMarkets?: unknown
  guaranteedTeacherSeats?: unknown
}

export const setSchoolQuotaAllocationCallable = onCall(callableOptions, async (request) => {
  const auth = requireTeacher(request)
  const data = request.data as SetAllocationRequest
  if (
    typeof data.parentOrgId !== 'string'
    || typeof data.schoolOrgId !== 'string'
    || !isNonNegativeInteger(data.guaranteedConcurrentLessonsAndMarkets)
    || !isNonNegativeInteger(data.guaranteedTeacherSeats)
  ) {
    throw new HttpsError('invalid-argument', '入力内容が不正です。')
  }
  const parentOrgId = data.parentOrgId
  const schoolOrgId = data.schoolOrgId
  const guaranteedConcurrentLessonsAndMarkets = data.guaranteedConcurrentLessonsAndMarkets
  const guaranteedTeacherSeats = data.guaranteedTeacherSeats

  const db = getFirestore()
  requireManager(await requireActiveOrgMember(db, parentOrgId, auth.uid))

  try {
    return await db.runTransaction(async (transaction) => {
      const parentRef = db.doc(`organizations/${parentOrgId}`)
      const schoolRef = db.doc(`organizations/${schoolOrgId}`)
      const [parentSnapshot, schoolSnapshot] = await Promise.all([
        transaction.get(parentRef),
        transaction.get(schoolRef),
      ])
      if (!parentSnapshot.exists || parentSnapshot.get('type') !== 'parentOrg') throw new Error('上位組織が見つかりません')
      assertParentContractAllowsSharedQuota(parentContractStateFrom(parentSnapshot.data()))
      if (
        !schoolSnapshot.exists
        || schoolSnapshot.get('type') !== 'school'
        || schoolSnapshot.get('parentOrgId') !== parentOrgId
      ) {
        throw new Error('対象の学校はこの上位組織の直下ではありません')
      }

      const allocationsQuery = db.collection(`organizations/${parentOrgId}/schoolAllocations`)
      const reservationsQuery = db.collection(`organizations/${parentOrgId}/quotaReservations`)
      const [limits, allocationsSnapshot, reservationsSnapshot] = await Promise.all([
        loadPlanLimits(transaction, db, parentSnapshot.data()),
        transaction.get(allocationsQuery),
        transaction.get(reservationsQuery),
      ])
      const nextAllocation: SchoolQuotaAllocation = {
        schoolOrgId,
        guaranteedConcurrentLessonsAndMarkets,
        guaranteedTeacherSeats,
      }
      const allocations = allocationsSnapshot.docs
        .map((document) => allocationFrom(document.id, document.data()))
        .filter((allocation) => allocation.schoolOrgId !== schoolOrgId)
        .concat(nextAllocation)
      const reservations = reservationsSnapshot.docs
        .map((document) => reservationFrom(document.id, document.data()))
        .filter((reservation): reservation is QuotaReservation => reservation !== null)

      validateAllocationChange({
        resourceKey: 'concurrentLessonsAndMarkets',
        parentLimit: limits.concurrentLessonsAndMarkets,
        allocations,
        reservations,
      })
      validateAllocationChange({
        resourceKey: 'teacherSeats',
        parentLimit: limits.teacherSeats,
        allocations,
        reservations,
      })

      transaction.set(db.doc(`organizations/${parentOrgId}/schoolAllocations/${schoolOrgId}`), {
        guaranteedConcurrentLessonsAndMarkets,
        guaranteedTeacherSeats,
        updatedAt: FieldValue.serverTimestamp(),
      })
      return nextAllocation
    })
  } catch (error) {
    return toFailedPrecondition(error)
  }
})

interface ResourceUsage {
  guaranteed: number
  usage: number
  reserved: number
}

const readSchoolUsage = async (transaction: Transaction, db: Firestore, schoolOrgId: string) => {
  const lessonRunsQuery = db.collection('lessonRuns')
    .where('orgId', '==', schoolOrgId)
    .where('status', 'in', ACTIVE_LESSON_RUN_STATUSES)
  const teachersQuery = db.collection(`organizations/${schoolOrgId}/members`)
    .where('status', '==', 'active')
    .where('role', '==', 'teacher')
  const [lessonRuns, teachers] = await Promise.all([
    transaction.get(lessonRunsQuery),
    transaction.get(teachersQuery),
  ])
  return { concurrentLessonsAndMarkets: lessonRuns.size, teacherSeats: teachers.size }
}

const readParentQuotaState = async (transaction: Transaction, db: Firestore, parentOrgId: string) => {
  const parentSnapshot = await transaction.get(db.doc(`organizations/${parentOrgId}`))
  if (!parentSnapshot.exists || parentSnapshot.get('type') !== 'parentOrg') throw new Error('上位組織が見つかりません')
  const allocationsQuery = db.collection(`organizations/${parentOrgId}/schoolAllocations`)
  const reservationsQuery = db.collection(`organizations/${parentOrgId}/quotaReservations`)
  const childSchoolsQuery = db.collection('organizations')
    .where('parentOrgId', '==', parentOrgId)
    .where('type', '==', 'school')
  const [limits, allocationsSnapshot, reservationsSnapshot, childSchoolsSnapshot] = await Promise.all([
    loadPlanLimits(transaction, db, parentSnapshot.data()),
    transaction.get(allocationsQuery),
    transaction.get(reservationsQuery),
    transaction.get(childSchoolsQuery),
  ])
  const persistedAllocations = new Map(
    allocationsSnapshot.docs.map((document) => [document.id, allocationFrom(document.id, document.data())]),
  )
  const childSchoolOrgIds = childSchoolsSnapshot.docs.map((document) => document.id)
  const missingAllocationSchoolOrgIds = childSchoolOrgIds.filter((schoolOrgId) => !persistedAllocations.has(schoolOrgId))
  const allocations = childSchoolOrgIds.map((schoolOrgId) => persistedAllocations.get(schoolOrgId) ?? {
    schoolOrgId,
    guaranteedConcurrentLessonsAndMarkets: 0,
    guaranteedTeacherSeats: 0,
  })
  const reservations = reservationsSnapshot.docs
    .map((document) => reservationFrom(document.id, document.data()))
    .filter((reservation): reservation is QuotaReservation => reservation !== null)
  return {
    limits,
    allocations,
    reservations,
    missingAllocationSchoolOrgIds,
    parentContractState: parentContractStateFrom(parentSnapshot.data()),
  }
}

const backfillMissingAllocations = (
  transaction: Transaction,
  db: Firestore,
  parentOrgId: string,
  schoolOrgIds: string[],
): void => {
  for (const schoolOrgId of schoolOrgIds) {
    transaction.set(db.doc(`organizations/${parentOrgId}/schoolAllocations/${schoolOrgId}`), {
      guaranteedConcurrentLessonsAndMarkets: 0,
      guaranteedTeacherSeats: 0,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
}

export const getParentOrgQuotaUsageCallable = onCall(callableOptions, async (request) => {
  const auth = requireTeacher(request)
  const data = request.data as { parentOrgId?: unknown }
  if (typeof data.parentOrgId !== 'string') throw new HttpsError('invalid-argument', 'parentOrgId は必須です。')
  const db = getFirestore()
  await requireActiveOrgMember(db, data.parentOrgId, auth.uid)

  try {
    return await db.runTransaction(async (transaction) => {
      const { limits, allocations, reservations, missingAllocationSchoolOrgIds, parentContractState } = await readParentQuotaState(transaction, db, data.parentOrgId as string)
      const usage = await Promise.all(allocations.map(async (allocation) => ({
        allocation,
        usage: await readSchoolUsage(transaction, db, allocation.schoolOrgId),
      })))
      const guaranteedConcurrent = allocations.reduce((sum, item) => sum + item.guaranteedConcurrentLessonsAndMarkets, 0)
      const guaranteedTeachers = allocations.reduce((sum, item) => sum + item.guaranteedTeacherSeats, 0)
      const reservedConcurrent = reservations.filter(({ resourceKey }) => resourceKey === 'concurrentLessonsAndMarkets').length
      const reservedTeachers = reservations.filter(({ resourceKey }) => resourceKey === 'teacherSeats').length
      backfillMissingAllocations(transaction, db, data.parentOrgId as string, missingAllocationSchoolOrgIds)

      return {
        parentOrgId: data.parentOrgId,
        parentContractState,
        concurrentLessonsAndMarkets: {
          limit: limits.concurrentLessonsAndMarkets,
          guaranteed: guaranteedConcurrent,
          sharedAvailable: Math.max(0, limits.concurrentLessonsAndMarkets - guaranteedConcurrent - reservedConcurrent),
          reserved: reservedConcurrent,
        },
        teacherSeats: {
          limit: limits.teacherSeats,
          guaranteed: guaranteedTeachers,
          sharedAvailable: Math.max(0, limits.teacherSeats - guaranteedTeachers - reservedTeachers),
          reserved: reservedTeachers,
        },
        schools: usage.map(({ allocation, usage: schoolUsage }) => ({
          schoolOrgId: allocation.schoolOrgId,
          concurrentLessonsAndMarkets: {
            guaranteed: allocation.guaranteedConcurrentLessonsAndMarkets,
            usage: schoolUsage.concurrentLessonsAndMarkets,
            reserved: reservations.filter(({ resourceKey, schoolOrgId }) => resourceKey === 'concurrentLessonsAndMarkets' && schoolOrgId === allocation.schoolOrgId).length,
          } satisfies ResourceUsage,
          teacherSeats: {
            guaranteed: allocation.guaranteedTeacherSeats,
            usage: schoolUsage.teacherSeats,
            reserved: reservations.filter(({ resourceKey, schoolOrgId }) => resourceKey === 'teacherSeats' && schoolOrgId === allocation.schoolOrgId).length,
          } satisfies ResourceUsage,
        })),
      }
    })
  } catch (error) {
    return toFailedPrecondition(error)
  }
})

export const getSchoolEffectiveQuotaCallable = onCall(callableOptions, async (request) => {
  const auth = requireTeacher(request)
  const data = request.data as { schoolOrgId?: unknown }
  if (typeof data.schoolOrgId !== 'string') throw new HttpsError('invalid-argument', 'schoolOrgId は必須です。')
  const schoolOrgId = data.schoolOrgId
  const db = getFirestore()
  await requireActiveOrgMember(db, schoolOrgId, auth.uid)

  try {
    return await db.runTransaction(async (transaction) => {
      const schoolSnapshot = await transaction.get(db.doc(`organizations/${schoolOrgId}`))
      if (!schoolSnapshot.exists || schoolSnapshot.get('type') !== 'school') {
        throw new Error('この学校はどの上位組織にも所属していません')
      }
      const parentOrgId = schoolSnapshot.get('parentOrgId') as string | undefined
      if (!parentOrgId) throw new Error('この学校はどの上位組織にも所属していません')
      const { limits, allocations, reservations, missingAllocationSchoolOrgIds, parentContractState } = await readParentQuotaState(transaction, db, parentOrgId)
      const allocation = allocations.find((item) => item.schoolOrgId === schoolOrgId)
      if (!allocation) throw new Error('この学校の配分が見つかりません')
      const usage = await readSchoolUsage(transaction, db, schoolOrgId)
      const guaranteedConcurrent = allocations.reduce((sum, item) => sum + item.guaranteedConcurrentLessonsAndMarkets, 0)
      const guaranteedTeachers = allocations.reduce((sum, item) => sum + item.guaranteedTeacherSeats, 0)
      const totalReservedConcurrent = reservations.filter(({ resourceKey }) => resourceKey === 'concurrentLessonsAndMarkets').length
      const totalReservedTeachers = reservations.filter(({ resourceKey }) => resourceKey === 'teacherSeats').length
      const ownReservedConcurrent = reservations.filter(({ resourceKey, schoolOrgId: reservedSchoolOrgId }) => resourceKey === 'concurrentLessonsAndMarkets' && reservedSchoolOrgId === schoolOrgId).length
      const ownReservedTeachers = reservations.filter(({ resourceKey, schoolOrgId: reservedSchoolOrgId }) => resourceKey === 'teacherSeats' && reservedSchoolOrgId === schoolOrgId).length
      backfillMissingAllocations(transaction, db, parentOrgId, missingAllocationSchoolOrgIds)

      return {
        schoolOrgId,
        parentOrgId,
        parentContractState,
        concurrentLessonsAndMarkets: {
          guaranteed: allocation.guaranteedConcurrentLessonsAndMarkets,
          usage: usage.concurrentLessonsAndMarkets,
          sharedReserved: ownReservedConcurrent,
          effectiveAvailable: allocation.guaranteedConcurrentLessonsAndMarkets
            + ownReservedConcurrent
            + Math.max(0, limits.concurrentLessonsAndMarkets - guaranteedConcurrent - totalReservedConcurrent),
        },
        teacherSeats: {
          guaranteed: allocation.guaranteedTeacherSeats,
          usage: usage.teacherSeats,
          sharedReserved: ownReservedTeachers,
          effectiveAvailable: allocation.guaranteedTeacherSeats
            + ownReservedTeachers
            + Math.max(0, limits.teacherSeats - guaranteedTeachers - totalReservedTeachers),
        },
      }
    })
  } catch (error) {
    return toFailedPrecondition(error)
  }
})

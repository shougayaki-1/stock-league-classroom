import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import type { LessonRunRole } from '@stock-league/lesson-runtime-types'
import { requireActiveOrgMember } from '../../organizations/authorization'
import {
  applyTeacherInterventionWithAdminSdk,
  canApplyIntervention,
  lessonInterventionTypes,
  transferPrimaryTeacherWithAdminSdk,
  type ApplyTeacherInterventionInput,
  type LessonInterventionType,
} from '../interventions'

const VALID_INTERVENTION_TYPES = new Set<LessonInterventionType>(lessonInterventionTypes)

interface TransferPrimaryTeacherRequest {
  lessonRunId: string
  newPrimaryTeacherUid: string
  reason: string
  idempotencyKey: string
}

/**
 * Authorization for the primary-teacher handoff itself lives in
 * `transferPrimaryTeacher` (interventions.ts) — it self-checks that the
 * caller currently holds PRIMARY via `canControlLesson('TRANSFER_PRIMARY', ...)`
 * and rejects otherwise, so this Callable does not duplicate that check. It
 * still requires the caller to be signed in and an active member of the
 * run's org, the same `requireActiveOrgMember` gate every other lessonRuns
 * Callable applies.
 */
export const transferPrimaryTeacherCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as TransferPrimaryTeacherRequest
  if (!data.lessonRunId || !data.newPrimaryTeacherUid || !data.reason?.trim() || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'lessonRunId、newPrimaryTeacherUid、reason、idempotencyKey は必須です。')
  }

  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${data.lessonRunId}`).get()
  if (!runSnap.exists) throw new HttpsError('not-found', 'レッスンランが見つかりません。')
  const orgId = runSnap.get('orgId') as string
  await requireActiveOrgMember(db, orgId, request.auth.uid)

  try {
    return await transferPrimaryTeacherWithAdminSdk({
      lessonRunId: data.lessonRunId,
      callerUid: request.auth.uid,
      newPrimaryTeacherUid: data.newPrimaryTeacherUid,
      reason: data.reason,
      idempotencyKey: data.idempotencyKey,
    })
  } catch (error) {
    throw translateTransferError(error)
  }
})

const translateTransferError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error) {
    if (error.message === 'LessonRun not found') return new HttpsError('not-found', error.message)
    if (error.message === 'Only the primary teacher may transfer the primary role') {
      return new HttpsError('permission-denied', error.message)
    }
    if (error.message === 'The new primary teacher must currently be an active assistant on this run') {
      return new HttpsError('failed-precondition', error.message)
    }
    if (error.message === 'Idempotency key payload mismatch') return new HttpsError('failed-precondition', error.message)
  }
  return error
}

interface ApplyTeacherInterventionRequest {
  lessonRunId: string
  type: LessonInterventionType
  reason: string
  before: unknown
  after: unknown
  impactScope: ApplyTeacherInterventionInput['impactScope']
  detail: Record<string, unknown>
  idempotencyKey: string
}

/**
 * Authorized against `canApplyIntervention(role, type)` (interventions.ts —
 * EXTEND_TIME delegates to authorization.ts's existing table, the other 8
 * types have their own PRIMARY/PRIMARY+ASSISTANT tiers), same
 * read-teacherRoles-from-the-run-doc pattern every other lessonRuns
 * Callable uses (see participants/onCall.ts's `requireLessonControlAuthorization`).
 */
export const applyTeacherInterventionCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as ApplyTeacherInterventionRequest
  if (
    !data.lessonRunId || !data.type || !data.reason?.trim() || !data.idempotencyKey
    || data.before === undefined || data.after === undefined || !data.impactScope || !data.detail
  ) {
    throw new HttpsError('invalid-argument', 'lessonRunId、type、reason、before、after、impactScope、detail、idempotencyKey は必須です。')
  }
  if (!VALID_INTERVENTION_TYPES.has(data.type)) {
    throw new HttpsError('invalid-argument', 'type の値が不正です。')
  }

  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${data.lessonRunId}`).get()
  if (!runSnap.exists) throw new HttpsError('not-found', 'レッスンランが見つかりません。')
  const teacherRoles = runSnap.get('teacherRoles') as Record<string, LessonRunRole> | undefined
  const role = teacherRoles?.[request.auth.uid]
  if (!role || !canApplyIntervention(role, data.type)) {
    throw new HttpsError('permission-denied', 'この操作を行う権限がありません。')
  }
  const orgId = runSnap.get('orgId') as string
  await requireActiveOrgMember(db, orgId, request.auth.uid)

  try {
    return await applyTeacherInterventionWithAdminSdk({
      lessonRunId: data.lessonRunId,
      type: data.type,
      reason: data.reason,
      before: data.before,
      after: data.after,
      impactScope: data.impactScope,
      detail: data.detail,
      idempotencyKey: data.idempotencyKey,
      actorId: request.auth.uid,
    })
  } catch (error) {
    throw translateInterventionError(error)
  }
})

const translateInterventionError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error) {
    if (error.message === 'LessonRun not found') return new HttpsError('not-found', error.message)
    if (error.message.startsWith('Missing required detail field')) return new HttpsError('invalid-argument', error.message)
    if (error.message.startsWith('Cannot restore a previous phase')) return new HttpsError('failed-precondition', error.message)
    if (error.message === 'Idempotency key payload mismatch') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'Team not found') return new HttpsError('not-found', error.message)
    if (error.message === 'New representative must be a member of the team') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'Participant not found') return new HttpsError('not-found', error.message)
    if (error.message === 'Response not found') return new HttpsError('not-found', error.message)
    if (error.message.startsWith('Invalid status transition')) return new HttpsError('failed-precondition', error.message)
  }
  return error
}

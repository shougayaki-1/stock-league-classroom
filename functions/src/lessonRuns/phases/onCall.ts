import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import type { LessonRunRole } from '@stock-league/lesson-runtime-types'
import { requireActiveOrgMember } from '../../organizations/authorization'
import { canControlLesson } from '../authorization'
import { transitionPhaseWithAdminSdk } from './transitionPhase'
import type { LessonRunStatus } from './stateMachine'

interface TransitionPhaseRequest {
  lessonRunId: string
  targetStatus?: LessonRunStatus
  targetPhaseId?: string
  reason: string
  idempotencyKey: string
}

const VALID_STATUSES = new Set<LessonRunStatus>([
  'DRAFT', 'READY', 'WAITING', 'RUNNING', 'PAUSED',
  'INTERRUPTED', 'REFLECTION', 'COMPLETED', 'ABORTED', 'ARCHIVED',
])

/**
 * TRANSITION_PHASE is classified PRIMARY-only in authorization.ts (see that
 * file's JSDoc: concurrent teachers issuing competing transitions could
 * race the lesson's overall progression, so — like START_LESSON/END_LESSON/
 * STOP_MARKET — it stays a single-decision-point action). `orgId` is always
 * read from the run document itself (never client input), same pattern as
 * every other lessonRuns Callable.
 */
export const transitionPhaseCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as TransitionPhaseRequest
  if (!data.lessonRunId || !data.reason?.trim() || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'lessonRunId、reason、idempotencyKey は必須です。')
  }
  if (!data.targetStatus && !data.targetPhaseId) {
    throw new HttpsError('invalid-argument', 'targetStatus または targetPhaseId のいずれかが必要です。')
  }
  if (data.targetStatus && data.targetPhaseId) {
    throw new HttpsError('invalid-argument', 'targetStatus と targetPhaseId は同時に指定できません。')
  }
  if (data.targetStatus && !VALID_STATUSES.has(data.targetStatus)) {
    throw new HttpsError('invalid-argument', 'targetStatus の値が不正です。')
  }

  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${data.lessonRunId}`).get()
  if (!runSnap.exists) throw new HttpsError('not-found', 'レッスンランが見つかりません。')
  const teacherRoles = runSnap.get('teacherRoles') as Record<string, LessonRunRole> | undefined
  const role = teacherRoles?.[request.auth.uid]
  if (!role || !canControlLesson(role, 'TRANSITION_PHASE')) {
    throw new HttpsError('permission-denied', 'この操作を行う権限がありません。')
  }
  const orgId = runSnap.get('orgId') as string
  await requireActiveOrgMember(db, orgId, request.auth.uid)

  try {
    return await transitionPhaseWithAdminSdk({
      lessonRunId: data.lessonRunId,
      targetStatus: data.targetStatus,
      targetPhaseId: data.targetPhaseId,
      reason: data.reason,
      idempotencyKey: data.idempotencyKey,
      actorId: request.auth.uid,
      actorType: 'TEACHER',
    })
  } catch (error) {
    throw translateTransitionPhaseError(error)
  }
})

/**
 * Translates transitionPhase's bare Error messages into HttpsError codes at
 * the Callable boundary, matching every other task's pure/DI-layer
 * convention (the pure layer stays free of firebase-functions).
 */
const translateTransitionPhaseError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error) {
    if (error.message === 'LessonRun not found') return new HttpsError('not-found', error.message)
    if (error.message.startsWith('Invalid status transition')) return new HttpsError('failed-precondition', error.message)
    if (error.message === 'Idempotency key payload mismatch') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'Nothing to transition: targetStatus or targetPhaseId is required') {
      return new HttpsError('invalid-argument', error.message)
    }
    if (error.message === 'targetStatus and targetPhaseId cannot both be specified in a single transition') {
      return new HttpsError('invalid-argument', error.message)
    }
    if (error.message.startsWith('Lesson failed start validation')) {
      return new HttpsError('failed-precondition', error.message)
    }
  }
  return error
}

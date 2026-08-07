import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import type { LessonRunRole } from '@stock-league/lesson-runtime-types'
import { requireActiveOrgMember } from '../../organizations/authorization'
import { canControlLesson } from '../authorization'
import {
  abortLessonWithAdminSdk,
  completeLessonWithAdminSdk,
  interruptLessonWithAdminSdk,
  resumeLessonWithAdminSdk,
} from '../recoveryLifecycle'

/**
 * Translates recoveryLifecycle's bare Error messages into HttpsError codes,
 * matching every other task's pure/DI-layer convention (recoveryLifecycle.ts
 * itself stays free of firebase-functions). The bare messages come from
 * Task 5's `transitionPhase` (invoked internally by every function here),
 * so this mirrors phases/onCall.ts's `translateTransitionPhaseError`.
 */
const translateLifecycleError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error) {
    if (error.message === 'LessonRun not found') return new HttpsError('not-found', error.message)
    if (error.message.startsWith('Invalid status transition')) return new HttpsError('failed-precondition', error.message)
    if (error.message === 'Idempotency key payload mismatch') return new HttpsError('failed-precondition', error.message)
    if (error.message.startsWith('Lesson failed start validation')) return new HttpsError('failed-precondition', error.message)
  }
  return error
}

const loadAuthorizedRun = async (
  request: { auth?: { uid: string } | null },
  lessonRunId: string | undefined,
  action: Parameters<typeof canControlLesson>[1],
): Promise<{ db: FirebaseFirestore.Firestore; orgId: string }> => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!lessonRunId) throw new HttpsError('invalid-argument', 'lessonRunId は必須です。')
  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${lessonRunId}`).get()
  if (!runSnap.exists) throw new HttpsError('not-found', 'レッスンランが見つかりません。')
  const teacherRoles = runSnap.get('teacherRoles') as Record<string, LessonRunRole> | undefined
  const role = teacherRoles?.[request.auth.uid]
  if (!role || !canControlLesson(role, action)) {
    throw new HttpsError('permission-denied', 'この操作を行う権限がありません。')
  }
  const orgId = runSnap.get('orgId') as string
  await requireActiveOrgMember(db, orgId, request.auth.uid)
  return { db, orgId }
}

interface InterruptLessonRequest {
  lessonRunId: string
  reason: string
  interimResults?: Record<string, unknown>
  resumePhaseId?: string | null
  resumeCheckpointId?: string | null
  idempotencyKey: string
}

/** TRANSITION_PHASE-gated (PRIMARY only), same reasoning as transitionPhaseCallable: a mid-run interrupt is a single-decision-point action. */
export const interruptLessonCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  const data = request.data as InterruptLessonRequest
  if (!data.reason?.trim() || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'reason、idempotencyKey は必須です。')
  }
  const { orgId } = await loadAuthorizedRun(request, data.lessonRunId, 'TRANSITION_PHASE')
  try {
    return await interruptLessonWithAdminSdk({
      lessonRunId: data.lessonRunId,
      orgId,
      reason: data.reason,
      interimResults: data.interimResults ?? {},
      resumePhaseId: data.resumePhaseId ?? null,
      resumeCheckpointId: data.resumeCheckpointId ?? null,
      idempotencyKey: data.idempotencyKey,
      actorId: request.auth!.uid,
    })
  } catch (error) {
    throw translateLifecycleError(error)
  }
})

interface ResumeLessonRequest {
  lessonRunId: string
  reason: string
  idempotencyKey: string
}

/**
 * INTERRUPTED → WAITING only (see recoveryLifecycle.ts's `resumeLesson`
 * JSDoc for why WAITING → RUNNING deliberately reuses the existing
 * `transitionPhaseCallable` instead of a second Callable here).
 */
export const resumeLessonCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  const data = request.data as ResumeLessonRequest
  if (!data.reason?.trim() || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'reason、idempotencyKey は必須です。')
  }
  await loadAuthorizedRun(request, data.lessonRunId, 'TRANSITION_PHASE')
  try {
    return await resumeLessonWithAdminSdk({
      lessonRunId: data.lessonRunId,
      reason: data.reason,
      idempotencyKey: data.idempotencyKey,
      actorId: request.auth!.uid,
    })
  } catch (error) {
    throw translateLifecycleError(error)
  }
})

interface CompleteLessonRequest {
  lessonRunId: string
  reason: string
  idempotencyKey: string
}

/** END_LESSON-gated (PRIMARY only) — §6.5 lists ending a lesson as a primary-teacher-exclusive action. */
export const completeLessonCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  const data = request.data as CompleteLessonRequest
  if (!data.reason?.trim() || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'reason、idempotencyKey は必須です。')
  }
  await loadAuthorizedRun(request, data.lessonRunId, 'END_LESSON')
  try {
    return await completeLessonWithAdminSdk({
      lessonRunId: data.lessonRunId,
      reason: data.reason,
      idempotencyKey: data.idempotencyKey,
      actorId: request.auth!.uid,
    })
  } catch (error) {
    throw translateLifecycleError(error)
  }
})

interface AbortLessonRequest {
  lessonRunId: string
  reason: string
  completedPhaseIds?: string[]
  idempotencyKey: string
}

/** END_LESSON-gated (PRIMARY only) — aborting is treated as another form of ending the lesson, same permission tier. */
export const abortLessonCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  const data = request.data as AbortLessonRequest
  if (!data.reason?.trim() || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'reason、idempotencyKey は必須です。')
  }
  const { orgId } = await loadAuthorizedRun(request, data.lessonRunId, 'END_LESSON')
  try {
    return await abortLessonWithAdminSdk({
      lessonRunId: data.lessonRunId,
      orgId,
      reason: data.reason,
      completedPhaseIds: data.completedPhaseIds ?? [],
      idempotencyKey: data.idempotencyKey,
      actorId: request.auth!.uid,
    })
  } catch (error) {
    throw translateLifecycleError(error)
  }
})

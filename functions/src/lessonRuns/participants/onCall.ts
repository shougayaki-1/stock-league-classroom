import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { joinLessonRunWithAdminSdk } from '../joinLessonRun'

interface JoinLessonRunRequest {
  joinCode: string
  identityMode: 'SCHOOL_ACCOUNT' | 'QUICK_JOIN' | 'TEAM_DEVICE'
  displayName: string
  externalIdentifier?: string
  idempotencyKey: string
}

const VALID_IDENTITY_MODES = new Set(['SCHOOL_ACCOUNT', 'QUICK_JOIN', 'TEAM_DEVICE'])

/**
 * Auth is required (any signed-in user — students may be anonymous/QUICK_JOIN
 * auth, so this deliberately does not gate on `isCallerTeacher` the way
 * createLessonRunCallable/restoreCheckpointCallable do). `authUid` is taken
 * from the verified token, never from `request.data`, matching every prior
 * Callable's pattern of resolving identity server-side.
 */
export const joinLessonRunCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as JoinLessonRunRequest
  if (!data.joinCode || !data.identityMode || !data.displayName?.trim() || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'joinCode、identityMode、displayName、idempotencyKey は必須です。')
  }
  if (!VALID_IDENTITY_MODES.has(data.identityMode)) {
    throw new HttpsError('invalid-argument', 'identityMode の値が不正です。')
  }
  try {
    return await joinLessonRunWithAdminSdk({
      joinCode: data.joinCode,
      identityMode: data.identityMode,
      displayName: data.displayName,
      externalIdentifier: data.externalIdentifier,
      idempotencyKey: data.idempotencyKey,
      authUid: request.auth.uid,
    })
  } catch (error) {
    throw translateJoinLessonRunError(error)
  }
})

/**
 * Translates joinLessonRun's bare Error messages into HttpsError codes at
 * the Callable boundary — the pure/DI layer (joinLessonRun.ts) stays free of
 * firebase-functions, matching every other task's established convention
 * (createLessonRun.ts, checkpoint.ts). Unrecognized errors pass through
 * unchanged.
 */
const translateJoinLessonRunError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error) {
    if (error.message === 'Join code not found') return new HttpsError('not-found', error.message)
    if (error.message === 'Join code is not active') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'LessonRun not found') return new HttpsError('not-found', error.message)
    if (error.message === 'LessonRun is not accepting participants') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'LessonRun has reached its maximum number of participants') return new HttpsError('resource-exhausted', error.message)
    if (error.message === 'Participant has been suspended from this lesson') return new HttpsError('permission-denied', error.message)
    if (error.message === 'Participant index is inconsistent') return new HttpsError('internal', error.message)
    if (error.message === 'Idempotency key payload mismatch') return new HttpsError('failed-precondition', error.message)
  }
  return error
}

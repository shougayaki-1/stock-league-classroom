import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { isCallerTeacher } from '../../organizations/onCall'
import { requireActiveOrgMember } from '../../organizations/authorization'
import {
  invalidateJoinCodeWithAdminSdk,
  issueJoinCodeWithAdminSdk,
  type IssueJoinCodeResult,
} from '../joinCodes'

interface IssueJoinCodeRequest {
  lessonRunId: string
}

interface InvalidateJoinCodeRequest {
  lessonRunId: string
  code: string
}

const translateJoinCodeError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error) {
    if (error.message === 'LessonRun not found') return new HttpsError('not-found', error.message)
    if (error.message === 'Join code not found') return new HttpsError('not-found', error.message)
    if (error.message === 'LessonRun is not accepting join codes in its current status') {
      return new HttpsError('failed-precondition', error.message)
    }
    if (error.message === 'Unable to allocate a unique join code') {
      return new HttpsError('resource-exhausted', error.message)
    }
  }
  return error
}

/**
 * Teacher-only Callable to issue a join code for a READY or WAITING lesson run.
 * PRIMARY or ASSISTANT role required on the specific run.
 */
export const issueJoinCodeCallable = onCall({ region: 'asia-northeast1' }, async (request): Promise<IssueJoinCodeResult> => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as IssueJoinCodeRequest
  if (!data || typeof data.lessonRunId !== 'string' || !data.lessonRunId) {
    throw new HttpsError('invalid-argument', 'lessonRunId は必須です。')
  }

  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${data.lessonRunId}`).get()
  if (!runSnap.exists) throw new HttpsError('not-found', 'レッスンランが見つかりません。')
  const teacherRoles = runSnap.get('teacherRoles') as Record<string, 'PRIMARY' | 'ASSISTANT' | 'VIEWER'> | undefined
  const role = teacherRoles?.[request.auth.uid]
  if (role !== 'PRIMARY' && role !== 'ASSISTANT') {
    throw new HttpsError('permission-denied', 'PRIMARYまたはASSISTANTの教師のみ参加コードを発行できます。')
  }
  const orgId = runSnap.get('orgId') as string
  await requireActiveOrgMember(db, orgId, request.auth.uid)

  try {
    return await issueJoinCodeWithAdminSdk({ lessonRunId: data.lessonRunId })
  } catch (error) {
    throw translateJoinCodeError(error)
  }
})

/**
 * Teacher-only Callable to invalidate an active join code.
 * PRIMARY or ASSISTANT role required on the specific run.
 */
export const invalidateJoinCodeCallable = onCall({ region: 'asia-northeast1' }, async (request): Promise<{ success: true }> => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as InvalidateJoinCodeRequest
  if (!data || typeof data.lessonRunId !== 'string' || !data.lessonRunId || typeof data.code !== 'string' || !data.code) {
    throw new HttpsError('invalid-argument', 'lessonRunId と code は必須です。')
  }

  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${data.lessonRunId}`).get()
  if (!runSnap.exists) throw new HttpsError('not-found', 'レッスンランが見つかりません。')
  const teacherRoles = runSnap.get('teacherRoles') as Record<string, 'PRIMARY' | 'ASSISTANT' | 'VIEWER'> | undefined
  const role = teacherRoles?.[request.auth.uid]
  if (role !== 'PRIMARY' && role !== 'ASSISTANT') {
    throw new HttpsError('permission-denied', 'PRIMARYまたはASSISTANTの教師のみ参加コードを失効できます。')
  }
  const orgId = runSnap.get('orgId') as string
  await requireActiveOrgMember(db, orgId, request.auth.uid)

  try {
    await invalidateJoinCodeWithAdminSdk({ code: data.code })
    return { success: true }
  } catch (error) {
    throw translateJoinCodeError(error)
  }
})

import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { isCallerTeacher } from '../../organizations/onCall'
import { requireActiveOrgMember } from '../../organizations/authorization'
import { exchangeDisplaySessionTokenWithAdminSdk, issueDisplaySessionTokenWithAdminSdk } from './displaySession'

interface IssueDisplaySessionTokenRequest { lessonRunId: string }

/**
 * Teacher-only, same authorization shape as restoreCheckpointCallable
 * (functions/src/lessonRuns/onCall.ts): signed-in teacher, PRIMARY/ASSISTANT
 * role on THIS run specifically (a VIEWER must not be able to mint a
 * classroom-display URL), and an active org membership resolved from the
 * run's own stored `orgId` (never client input).
 */
export const issueDisplaySessionTokenCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as IssueDisplaySessionTokenRequest
  if (!data.lessonRunId) throw new HttpsError('invalid-argument', 'lessonRunId は必須です。')

  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${data.lessonRunId}`).get()
  if (!runSnap.exists) throw new HttpsError('not-found', 'レッスンランが見つかりません。')
  const teacherRoles = runSnap.get('teacherRoles') as Record<string, 'PRIMARY' | 'ASSISTANT' | 'VIEWER'> | undefined
  const role = teacherRoles?.[request.auth.uid]
  if (role !== 'PRIMARY' && role !== 'ASSISTANT') {
    throw new HttpsError('permission-denied', 'PRIMARYまたはASSISTANTの教師のみ教室表示URLを発行できます。')
  }
  const orgId = runSnap.get('orgId') as string
  await requireActiveOrgMember(db, orgId, request.auth.uid)

  const result = await issueDisplaySessionTokenWithAdminSdk({ lessonRunId: data.lessonRunId, orgId })
  return result
})

interface ExchangeDisplaySessionTokenRequest { lessonRunId: string; token: string }

/**
 * Deliberately UNAUTHENTICATED: the classroom-projector page that calls
 * this has no signed-in user yet — the whole point of the flow (this task's
 * brief Step 3) is that possessing the one-time `token` (delivered only via
 * the projector URL a teacher set up) is itself the credential. No
 * `request.auth` check exists here on purpose; do not add one, and do not
 * add a broader read grant anywhere else to compensate for a missing one —
 * `exchangeDisplaySessionToken`'s own hash/status/expiry/lessonRunId checks
 * (displaySession.ts) are the entire authorization boundary for this
 * Callable.
 */
export const exchangeDisplaySessionTokenCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  const data = request.data as ExchangeDisplaySessionTokenRequest
  if (!data.lessonRunId || !data.token) throw new HttpsError('invalid-argument', 'lessonRunId と token は必須です。')
  try {
    return await exchangeDisplaySessionTokenWithAdminSdk({ lessonRunId: data.lessonRunId, token: data.token })
  } catch (error) {
    throw translateExchangeError(error)
  }
})

const translateExchangeError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error) {
    if (error.message === 'Display session token not found') return new HttpsError('not-found', error.message)
    if (error.message === 'Display session token has already been used') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'Display session token has expired') return new HttpsError('failed-precondition', error.message)
  }
  return error
}

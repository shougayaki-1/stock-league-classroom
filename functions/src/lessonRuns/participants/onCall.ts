import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import type { LessonRunRole } from '@stock-league/lesson-runtime-types'
import { requireActiveOrgMember } from '../../organizations/authorization'
import { canControlLesson } from '../authorization'
import { joinLessonRunWithAdminSdk } from '../joinLessonRun'
import { issueRecoveryCodeWithAdminSdk, recoverParticipantWithAdminSdk } from '../recovery'
import { assignParticipantToTeamWithAdminSdk, rotateRepresentativeWithAdminSdk } from '../teams/assignTeam'

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

/**
 * Shared teacher-authorization guard for the team/recovery Callables below:
 * reads `lessonRuns/{lessonRunId}` for `orgId`/`teacherRoles`, requires the
 * caller hold a role on THIS run for which `canControlLesson(role, action)`
 * is true, and requires that role be an active org member — the same
 * two-step pattern `restoreCheckpointCallable` (lessonRuns/onCall.ts) uses,
 * extracted here since four Callables need it. `orgId` is always read from
 * the run document, never taken from client input.
 */
const requireLessonControlAuthorization = async (
  lessonRunId: string,
  uid: string,
  action: Parameters<typeof canControlLesson>[1],
): Promise<{ orgId: string }> => {
  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${lessonRunId}`).get()
  if (!runSnap.exists) throw new HttpsError('not-found', 'レッスンランが見つかりません。')
  const teacherRoles = runSnap.get('teacherRoles') as Record<string, LessonRunRole> | undefined
  const role = teacherRoles?.[uid]
  if (!role || !canControlLesson(role, action)) {
    throw new HttpsError('permission-denied', 'この操作を行う権限がありません。')
  }
  const orgId = runSnap.get('orgId') as string
  await requireActiveOrgMember(db, orgId, uid)
  return { orgId }
}

interface AssignParticipantToTeamRequest {
  lessonRunId: string
  participantId: string
  idempotencyKey: string
}

/**
 * Teacher-only: forming/re-balancing teams is part of running the lesson,
 * so it is gated the same way SUPPORT_STUDENT-class actions are
 * (PRIMARY or ASSISTANT teacher on this run, per authorization.ts's §6.5
 * table) — a VIEWER-role teacher may watch but not reshuffle teams.
 */
export const assignParticipantToTeamCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as AssignParticipantToTeamRequest
  if (!data.lessonRunId || !data.participantId || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'lessonRunId、participantId、idempotencyKey は必須です。')
  }
  await requireLessonControlAuthorization(data.lessonRunId, request.auth.uid, 'SUPPORT_STUDENT')
  try {
    return await assignParticipantToTeamWithAdminSdk({
      lessonRunId: data.lessonRunId, participantId: data.participantId,
      idempotencyKey: data.idempotencyKey, actorId: request.auth.uid,
    })
  } catch (error) {
    throw translateTeamError(error)
  }
})

interface RotateRepresentativeRequest {
  lessonRunId: string
  teamId: string
  newRepresentativeParticipantId: string
  reason: string
  idempotencyKey: string
  expectedVersion?: number
}

/** Teacher-only, same gate as assignParticipantToTeamCallable — a manual representative change is a teacher-mediated action from the Callable surface (a future task may add a student-self-service path with a different authorization check; out of this task's scope). */
export const rotateRepresentativeCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as RotateRepresentativeRequest
  if (!data.lessonRunId || !data.teamId || !data.newRepresentativeParticipantId || !data.reason?.trim() || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'lessonRunId、teamId、newRepresentativeParticipantId、reason、idempotencyKey は必須です。')
  }
  await requireLessonControlAuthorization(data.lessonRunId, request.auth.uid, 'SUPPORT_STUDENT')
  try {
    return await rotateRepresentativeWithAdminSdk({
      lessonRunId: data.lessonRunId, teamId: data.teamId,
      newRepresentativeParticipantId: data.newRepresentativeParticipantId,
      reason: data.reason, idempotencyKey: data.idempotencyKey,
      expectedVersion: data.expectedVersion, actorId: request.auth.uid, actorType: 'TEACHER',
    })
  } catch (error) {
    throw translateTeamError(error)
  }
})

const translateTeamError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error) {
    if (error.message === 'Participant not found') return new HttpsError('not-found', error.message)
    if (error.message === 'Participant is already assigned to a team') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'No teams available for assignment') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'Team not found') return new HttpsError('not-found', error.message)
    if (error.message.startsWith('Team not found:')) return new HttpsError('not-found', error.message)
    if (error.message === 'New representative must be a member of the team') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'Team version mismatch') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'Idempotency key payload mismatch') return new HttpsError('failed-precondition', error.message)
  }
  return error
}

interface IssueRecoveryCodeRequest {
  lessonRunId: string
  participantId: string
  idempotencyKey: string
}

/**
 * Teacher-only: a recovery code is issued after a teacher verifies (in
 * person, out of band) that the requester really is the student behind
 * `participantId` whose device broke or was lost — the Callable itself has
 * no way to verify a student's identity, so it defers that judgment to the
 * teacher and gates on HANDLE_CONNECTION (§6.5's "接続対応" bucket:
 * PRIMARY or ASSISTANT), the same connection-recovery-flavored action
 * device-migration support falls under.
 */
export const issueRecoveryCodeCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as IssueRecoveryCodeRequest
  if (!data.lessonRunId || !data.participantId || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'lessonRunId、participantId、idempotencyKey は必須です。')
  }
  await requireLessonControlAuthorization(data.lessonRunId, request.auth.uid, 'HANDLE_CONNECTION')
  try {
    return await issueRecoveryCodeWithAdminSdk({
      lessonRunId: data.lessonRunId, participantId: data.participantId, idempotencyKey: data.idempotencyKey,
    })
  } catch (error) {
    throw translateRecoveryError(error)
  }
})

interface RecoverParticipantRequest {
  lessonRunId: string
  code: string
  idempotencyKey: string
}

/**
 * Student-facing, not teacher-gated: the caller is the student on the NEW
 * device, signing in fresh (often a new anonymous/QUICK_JOIN auth session)
 * — they hold no teacher role on this run, so `requireLessonControlAuthorization`
 * does not apply here. Authorization instead comes from possessing the
 * one-time recovery code itself: only `request.auth` (any signed-in user)
 * is required, matching `joinLessonRunCallable`'s reasoning. `newAuthUid` is
 * always the verified token's uid, never client input.
 */
export const recoverParticipantCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as RecoverParticipantRequest
  if (!data.lessonRunId || !data.code || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'lessonRunId、code、idempotencyKey は必須です。')
  }
  try {
    return await recoverParticipantWithAdminSdk({
      lessonRunId: data.lessonRunId, code: data.code,
      newAuthUid: request.auth.uid, idempotencyKey: data.idempotencyKey,
    })
  } catch (error) {
    throw translateRecoveryError(error)
  }
})

const translateRecoveryError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error) {
    if (error.message === 'Participant not found') return new HttpsError('not-found', error.message)
    if (error.message === 'Recovery code not found') return new HttpsError('not-found', error.message)
    if (error.message === 'Recovery code has already been used') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'Recovery code has expired') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'Recovery code already issued for this idempotencyKey') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'Idempotency key payload mismatch') return new HttpsError('failed-precondition', error.message)
  }
  return error
}

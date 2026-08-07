import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import type { ParticipantId, TeamId } from '@stock-league/lesson-runtime-types'
import type { LessonInputValue } from '@stock-league/lesson-inputs'
import { confirmResponseWithAdminSdk } from './confirmResponse'
import { decideProposalWithAdminSdk, saveResponseDraftWithAdminSdk, submitProposalWithAdminSdk } from './saveResponse'

/**
 * Resolves the caller's `participantId` on this lessonRun from the verified
 * auth uid, via the `participantsByAuthUid/{authUid}` O(1) index doc
 * joinLessonRun.ts maintains — never trusted from client input, matching
 * every other STUDENT-actor Callable's server-side identity resolution.
 * Read-only; not part of any of the write transactions below (each of those
 * re-validates team membership itself in `resolveResponseScope`).
 */
const resolveActorParticipantId = async (lessonRunId: string, authUid: string): Promise<ParticipantId> => {
  const db = getFirestore()
  const indexSnap = await db.doc(`lessonRuns/${lessonRunId}/participantsByAuthUid/${authUid}`).get()
  if (!indexSnap.exists) throw new HttpsError('failed-precondition', 'このレッスンランに参加していません。')
  const { participantId } = indexSnap.data() as { participantId: ParticipantId }
  return participantId
}

interface ResponseScopeRequest {
  lessonRunId: string
  participantId?: string
  teamId?: string
  phaseId: string
  inputId: string
}

const validateScopeRequest = (data: ResponseScopeRequest): void => {
  if (!data.lessonRunId || !data.phaseId || !data.inputId) {
    throw new HttpsError('invalid-argument', 'lessonRunId、phaseId、inputId は必須です。')
  }
  if (data.participantId && data.teamId) {
    throw new HttpsError('invalid-argument', 'participantId と teamId は同時に指定できません。')
  }
  if (!data.participantId && !data.teamId) {
    throw new HttpsError('invalid-argument', 'participantId または teamId のいずれかが必要です。')
  }
}

/**
 * Translates the pure/DI layer's bare Error messages into HttpsError codes,
 * matching every other task's Callable-boundary convention (transitionPhase's
 * onCall.ts, joinLessonRun's index.ts).
 */
const translateResponseError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error) {
    if (error.message === 'Team not found') return new HttpsError('not-found', error.message)
    if (error.message === 'Participant not found') return new HttpsError('not-found', error.message)
    if (error.message === 'Response not found') return new HttpsError('not-found', error.message)
    if (error.message === 'Participant is not a member of this team') return new HttpsError('permission-denied', error.message)
    if (error.message === 'Participant cannot act on another participant\'s response') return new HttpsError('permission-denied', error.message)
    if (error.message === 'Participant is not authorized to decide this team\'s response') return new HttpsError('permission-denied', error.message)
    if (error.message === 'Only the team representative may confirm this response') return new HttpsError('permission-denied', error.message)
    if (error.message === 'Response has already been confirmed and cannot be edited') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'Response has already been confirmed') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'Response has not been approved and cannot be confirmed') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'Response revision is stale') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'Response must be in DRAFT status to submit a proposal') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'Response must be in PROPOSED status to decide') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'Idempotency key payload mismatch') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'participantId and teamId cannot both be specified') return new HttpsError('invalid-argument', error.message)
    if (error.message === 'Either participantId or teamId is required') return new HttpsError('invalid-argument', error.message)
  }
  return error
}

interface SaveResponseDraftRequest extends ResponseScopeRequest {
  value: LessonInputValue
  rationaleInformationIds?: string[]
  expectedRevision?: number
  idempotencyKey: string
}

/**
 * DRAFT-state autosave. Any signed-in participant on this lessonRun may call
 * it as often as they like (see saveResponse.ts's JSDoc) — the only gate is
 * that `resolveResponseScope` confirms they own (or are a member of the
 * team that owns) the target response.
 */
export const saveResponseDraftCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as SaveResponseDraftRequest
  validateScopeRequest(data)
  if (data.value === undefined || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'value、idempotencyKey は必須です。')
  }
  const actorParticipantId = await resolveActorParticipantId(data.lessonRunId, request.auth.uid)
  try {
    return await saveResponseDraftWithAdminSdk({
      lessonRunId: data.lessonRunId,
      participantId: data.participantId as ParticipantId | undefined,
      teamId: data.teamId as TeamId | undefined,
      phaseId: data.phaseId,
      inputId: data.inputId,
      value: data.value,
      rationaleInformationIds: data.rationaleInformationIds,
      expectedRevision: data.expectedRevision,
      idempotencyKey: data.idempotencyKey,
      actorId: request.auth.uid,
      actorParticipantId,
    })
  } catch (error) {
    throw translateResponseError(error)
  }
})

interface SubmitProposalRequest extends ResponseScopeRequest {
  expectedRevision: number
  idempotencyKey: string
}

/** DRAFT -> PROPOSED. */
export const submitProposalCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as SubmitProposalRequest
  validateScopeRequest(data)
  if (data.expectedRevision === undefined || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'expectedRevision、idempotencyKey は必須です。')
  }
  const actorParticipantId = await resolveActorParticipantId(data.lessonRunId, request.auth.uid)
  try {
    return await submitProposalWithAdminSdk({
      lessonRunId: data.lessonRunId,
      participantId: data.participantId as ParticipantId | undefined,
      teamId: data.teamId as TeamId | undefined,
      phaseId: data.phaseId,
      inputId: data.inputId,
      expectedRevision: data.expectedRevision,
      idempotencyKey: data.idempotencyKey,
      actorId: request.auth.uid,
      actorParticipantId,
    })
  } catch (error) {
    throw translateResponseError(error)
  }
})

interface DecideProposalRequest extends ResponseScopeRequest {
  decision: 'APPROVE' | 'REJECT'
  idempotencyKey: string
}

/** PROPOSED -> APPROVED/REJECTED (individual decision, or one vote toward a team's ALL/QUORUM aggregation). */
export const decideProposalCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as DecideProposalRequest
  validateScopeRequest(data)
  if ((data.decision !== 'APPROVE' && data.decision !== 'REJECT') || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'decision(APPROVE/REJECT)、idempotencyKey は必須です。')
  }
  const actorParticipantId = await resolveActorParticipantId(data.lessonRunId, request.auth.uid)
  try {
    return await decideProposalWithAdminSdk({
      lessonRunId: data.lessonRunId,
      participantId: data.participantId as ParticipantId | undefined,
      teamId: data.teamId as TeamId | undefined,
      phaseId: data.phaseId,
      inputId: data.inputId,
      decision: data.decision,
      idempotencyKey: data.idempotencyKey,
      actorId: request.auth.uid,
      actorParticipantId,
    })
  } catch (error) {
    throw translateResponseError(error)
  }
})

interface ConfirmResponseRequest extends ResponseScopeRequest {
  idempotencyKey: string
}

/** APPROVED -> CONFIRMED, the final step. */
export const confirmResponseCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as ConfirmResponseRequest
  validateScopeRequest(data)
  if (!data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'idempotencyKey は必須です。')
  }
  const actorParticipantId = await resolveActorParticipantId(data.lessonRunId, request.auth.uid)
  try {
    return await confirmResponseWithAdminSdk({
      lessonRunId: data.lessonRunId,
      participantId: data.participantId as ParticipantId | undefined,
      teamId: data.teamId as TeamId | undefined,
      phaseId: data.phaseId,
      inputId: data.inputId,
      idempotencyKey: data.idempotencyKey,
      actorId: request.auth.uid,
      actorParticipantId,
    })
  } catch (error) {
    throw translateResponseError(error)
  }
})

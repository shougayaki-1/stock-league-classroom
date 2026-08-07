import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import type { ParticipantId } from '@stock-league/lesson-runtime-types'
import type { JsonValue } from '../responses/repository'
import { submitSurveyWithAdminSdk } from './submitSurvey'

/**
 * Same resolution as `responses/onCall.ts`'s `resolveActorParticipantId`:
 * the caller's participant identity on this lessonRun, from the
 * `participantsByAuthUid` index, never trusted from client input. Reused
 * verbatim rather than imported — `responses/onCall.ts` does not export it
 * and duplicating this small lookup keeps `surveys/` free of a
 * cross-directory coupling for a three-line helper (matches how
 * `assignTeam.ts`/`saveResponse.ts` each keep their own scope-resolution
 * helpers rather than sharing one).
 */
const resolveActorParticipantId = async (lessonRunId: string, authUid: string): Promise<ParticipantId> => {
  const db = getFirestore()
  const indexSnap = await db.doc(`lessonRuns/${lessonRunId}/participantsByAuthUid/${authUid}`).get()
  if (!indexSnap.exists) throw new HttpsError('failed-precondition', 'このレッスンランに参加していません。')
  const { participantId } = indexSnap.data() as { participantId: ParticipantId }
  return participantId
}

interface SubmitSurveyRequest {
  lessonRunId: string
  resultId: string
  answers: Record<string, JsonValue>
  idempotencyKey: string
  expectedRevision?: number
}

const translateSubmitSurveyError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error) {
    if (error.message === 'Participant not found for this lessonRun') return new HttpsError('permission-denied', error.message)
    if (error.message === 'Suspended participants may not submit a survey response') return new HttpsError('permission-denied', error.message)
    if (error.message === 'Survey response revision is stale') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'Idempotency key payload mismatch') return new HttpsError('failed-precondition', error.message)
    if (error.message === 'lessonRunId, resultId, and participantId are all required') return new HttpsError('invalid-argument', error.message)
  }
  return error
}

/**
 * Student-facing (any signed-in participant on this lessonRun — including
 * `ABSENT`, see `submitSurvey.ts`'s `resolveParticipant` JSDoc for the
 * authorization design). `participantId` is always the caller's own
 * server-resolved identity; a student can never submit a survey response
 * on another participant's behalf through this Callable.
 */
export const submitSurveyCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as SubmitSurveyRequest
  if (!data.lessonRunId || !data.resultId || !data.answers || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'lessonRunId、resultId、answers、idempotencyKey は必須です。')
  }
  const runSnap = await getFirestore().doc(`lessonRuns/${data.lessonRunId}`).get()
  if (!runSnap.exists) throw new HttpsError('not-found', 'レッスンランが見つかりません。')
  const orgId = runSnap.get('orgId') as string
  const participantId = await resolveActorParticipantId(data.lessonRunId, request.auth.uid)
  try {
    return await submitSurveyWithAdminSdk({
      lessonRunId: data.lessonRunId,
      resultId: data.resultId,
      participantId,
      answers: data.answers,
      idempotencyKey: data.idempotencyKey,
      expectedRevision: data.expectedRevision,
      orgId,
    })
  } catch (error) {
    throw translateSubmitSurveyError(error)
  }
})

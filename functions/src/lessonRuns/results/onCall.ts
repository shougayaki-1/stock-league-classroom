import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { loadAuthorizedRun } from '../lifecycle/onCall'
import { buildAndPersistLessonResultWithAdminSdk, type LessonResult } from './buildResults'

interface GenerateLessonResultRequest {
  lessonRunId: string
  phaseId: string
  idempotencyKey: string
  externalTaskUrl?: string
  externalResultUrl?: string
}

const translateGenerateResultError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error && error.message === 'Idempotency key payload mismatch') {
    return new HttpsError('failed-precondition', error.message)
  }
  return error
}

/** Teacher-only (PRIMARY/ASSISTANT). Persists a `LessonResult` for the given phase — see buildResults.ts's own JSDoc for why nothing calls this automatically today. */
export const generateLessonResultCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  const data = request.data as GenerateLessonResultRequest
  if (!data.lessonRunId || !data.phaseId || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'lessonRunId、phaseId、idempotencyKey は必須です。')
  }
  const { orgId } = await loadAuthorizedRun(request, data.lessonRunId, 'GENERATE_RESULTS')
  try {
    return await buildAndPersistLessonResultWithAdminSdk({
      lessonRunId: data.lessonRunId,
      orgId,
      phaseId: data.phaseId,
      externalTaskUrl: data.externalTaskUrl,
      externalResultUrl: data.externalResultUrl,
      idempotencyKey: data.idempotencyKey,
      actorId: request.auth!.uid,
    })
  } catch (error) {
    throw translateGenerateResultError(error)
  }
})

/**
 * Same `participantsByAuthUid/{authUid}` index-lookup pattern as
 * `market/onCall.ts`'s `resolveActorParticipantId` — never trusted from
 * client input, resolved server-side from the verified auth uid.
 */
const resolveActorParticipantId = async (lessonRunId: string, authUid: string): Promise<string> => {
  const db = getFirestore()
  const indexSnap = await db.doc(`lessonRuns/${lessonRunId}/participantsByAuthUid/${authUid}`).get()
  if (!indexSnap.exists) throw new HttpsError('failed-precondition', 'このレッスンランに参加していません。')
  const { participantId } = indexSnap.data() as { participantId: string }
  return participantId
}

interface GetMyLessonResultRequest {
  lessonRunId: string
}

export interface GetMyLessonResultItem {
  responseId: string
  scope: 'participant' | 'team'
  displayValue: string
  decisionExplanation: LessonResult['responses'][number]['decisionExplanation']
}

export interface GetMyLessonResultResult {
  found: boolean
  lessonRunId: string
  externalTaskUrl?: string
  externalResultUrl?: string
  items: GetMyLessonResultItem[]
}

const formatDisplayValue = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value))

/**
 * Student-facing. Reads the most recently generated `LessonResult` for this
 * lessonRun (server-side, Admin SDK — `firestore.rules` keeps `results/`
 * teacher-read-only for the client SDK on purpose) and returns ONLY the
 * responses whose `participantId` matches the caller's own resolved
 * identity, or whose `teamId` matches the caller's own team — never any
 * other participant's or team's response (§23.6 identity protection, same
 * discipline `LessonResultsPage`'s own JSDoc documents on the client side).
 */
export const getMyLessonResultCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as GetMyLessonResultRequest
  if (!data.lessonRunId) throw new HttpsError('invalid-argument', 'lessonRunId は必須です。')

  const db = getFirestore()
  const participantId = await resolveActorParticipantId(data.lessonRunId, request.auth.uid)
  const participantSnap = await db.doc(`lessonRuns/${data.lessonRunId}/participants/${participantId}`).get()
  const teamId = participantSnap.exists ? (participantSnap.data() as { teamId?: string }).teamId : undefined

  const resultsSnap = await db.collection(`lessonRuns/${data.lessonRunId}/results`).orderBy('generatedAt', 'desc').limit(1).get()
  if (resultsSnap.empty) return { found: false, lessonRunId: data.lessonRunId, items: [] } satisfies GetMyLessonResultResult

  const result = resultsSnap.docs[0].data() as LessonResult
  const items: GetMyLessonResultItem[] = result.responses
    .filter((response) => response.participantId === participantId || (teamId !== undefined && response.teamId === teamId))
    .map((response) => ({
      responseId: response.responseId,
      scope: response.scope,
      displayValue: formatDisplayValue(response.value),
      decisionExplanation: response.decisionExplanation,
    }))

  return {
    found: true,
    lessonRunId: data.lessonRunId,
    ...(result.externalTaskUrl ? { externalTaskUrl: result.externalTaskUrl } : {}),
    ...(result.externalResultUrl ? { externalResultUrl: result.externalResultUrl } : {}),
    items,
  } satisfies GetMyLessonResultResult
})

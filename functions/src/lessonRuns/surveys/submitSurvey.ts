import { getFirestore } from 'firebase-admin/firestore'
import type { ParticipantId } from '@stock-league/lesson-runtime-types'
import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../../lib/idempotency'
import type { FirestoreTx } from '../appendLessonEvent'
import type { JsonValue } from '../responses/repository'

/**
 * Firestore system of record at
 * `lessonRuns/{lessonRunId}/results/{resultId}/surveyResponses/{id}`.
 * Always carries `lessonRunId`/`resultId`/`participantId` (brief Step 3's
 * explicit requirement) so a survey response can never be orphaned from the
 * result it is reflecting on, or from the participant who filed it.
 * `answers` is keyed by `LessonSurveyQuestionType` (schema.ts) but stored as
 * a loose `Record<string, JsonValue>` here — validating each answer against
 * its question's expected shape (a 1-5 scale vs. free text) is a UI/Callable
 * boundary concern (see onCall.ts), not this persistence layer's.
 */
export interface LessonSurveyResponse {
  id: string
  lessonRunId: string
  orgId: string
  resultId: string
  participantId: ParticipantId
  answers: Record<string, JsonValue>
  revision: number
  submittedAt: unknown
}

export interface ResolvedParticipant {
  orgId: string
  status: string
}

export interface SurveyFirestoreDeps {
  firestore: { runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => Promise<T> }
  orgId: string
  now?: () => unknown
  /**
   * The authorization gate for "who may submit a survey response",
   * including the brief's "欠席者への限定アクセスはmembershipを限定再発行
   * して提供する" requirement (Step 3).
   *
   * DESIGN DECISION (see task-14-report.md for the full rationale): rather
   * than introducing a new RTDB mirror node the way `lessonRunMembership`
   * (membershipMirror.ts) does, this authorization is expressed entirely
   * at the Callable boundary — `submitSurvey` (and any future
   * results-reading Callable) never grants a broad, always-on RTDB
   * `.read` the way `lessonRunPublic`/`lessonRunTeamState` do. Every call
   * is individually authorized against the Firestore participant record,
   * so scoping who gets "results + survey only" access is just "does
   * `resolveParticipant` return a non-SUSPENDED participant for this
   * lessonRunId" — no RTDB rule can accidentally leak broader access,
   * because none is granted in the first place. This sidesteps the
   * "an ancestor's wide `.read` cannot be revoked by a descendant's
   * `.read: false`" RTDB constraint noted in Task 2's rules (there is
   * nothing to revoke, because nothing was granted).
   *
   * Unlike `activeParticipantStatuses` (membershipMirror.ts) — which is
   * about live-lesson realtime access and treats `ABSENT` as inactive —
   * this gate deliberately treats `ABSENT` as *allowed*: an absent
   * student did not participate live, but the brief explicitly wants them
   * to see results/reflection materials and answer the survey. Only
   * `SUSPENDED` (a punitive status) is rejected.
   *
   * Defaults to "no check" (always authorized) so unit tests that are not
   * exercising authorization can omit it — the real Callable wiring
   * (`submitSurveyWithAdminSdk`) always supplies a real Firestore-backed
   * implementation.
   */
  resolveParticipant?: (lessonRunId: string, participantId: ParticipantId) => Promise<ResolvedParticipant | undefined>
}

export interface SubmitSurveyInput {
  lessonRunId: string
  resultId: string
  participantId: ParticipantId
  answers: Record<string, JsonValue>
  idempotencyKey: string
  /** The revision the client last saw, if resubmitting. Omit for a first submission. */
  expectedRevision?: number
}

export interface SubmitSurveyResult {
  surveyResponseId: string
  revision: number
  deduplicated: boolean
}

const deriveSurveyResponseId = (lessonRunId: string, resultId: string, participantId: ParticipantId): string =>
  idempotencyDocumentId(lessonRunId, `survey:${resultId}:${participantId}`)

/**
 * Upserts a `LessonSurveyResponse`. Deterministic id (one document per
 * lessonRun/result/participant triple) so a resubmission always targets the
 * same doc, incrementing `revision`:
 *
 *  - The exact same `idempotencyKey` with the exact same payload is
 *    deduplicated (idempotent retry) — same digest-comparison pattern as
 *    every other Task in this codebase (saveResponse.ts et al.).
 *  - A fresh `idempotencyKey` always creates a new revision (a genuine
 *    resubmission — e.g. the student changed an answer), unless
 *    `expectedRevision` is supplied and does not match the current
 *    revision, in which case it is rejected as a stale-write conflict
 *    (same optimistic-concurrency shape as `saveResponseDraft`).
 */
export const submitSurvey = async (
  deps: SurveyFirestoreDeps,
  input: SubmitSurveyInput,
): Promise<SubmitSurveyResult> => {
  if (!input.lessonRunId || !input.resultId || !input.participantId) {
    throw new Error('lessonRunId, resultId, and participantId are all required')
  }

  if (deps.resolveParticipant) {
    const participant = await deps.resolveParticipant(input.lessonRunId, input.participantId)
    if (!participant) throw new Error('Participant not found for this lessonRun')
    if (participant.status === 'SUSPENDED') {
      throw new Error('Suspended participants may not submit a survey response')
    }
  }

  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  const surveyResponseId = deriveSurveyResponseId(input.lessonRunId, input.resultId, input.participantId)
  const responsePath = `lessonRuns/${input.lessonRunId}/results/${input.resultId}/surveyResponses/${surveyResponseId}`
  const idempotencyPath = `${responsePath}/submitSurveyIdempotency/${idempotencyDocumentId(surveyResponseId, input.idempotencyKey)}`
  const requestDigest = computeRequestDigest({ answers: input.answers, expectedRevision: input.expectedRevision ?? null })

  return deps.firestore.runTransaction(async (tx) => {
    // ---- READ PHASE ----
    const existingIdempotency = await tx.get(idempotencyPath)
    if (existingIdempotency.exists) {
      const prior = existingIdempotency.data() as { requestDigest: string; revision: number }
      if (prior.requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
      return { surveyResponseId, revision: prior.revision, deduplicated: true }
    }

    const existingSnap = await tx.get(responsePath)
    const existing = existingSnap.exists ? (existingSnap.data() as unknown as LessonSurveyResponse) : undefined
    if (existing && input.expectedRevision !== undefined && input.expectedRevision !== existing.revision) {
      throw new Error('Survey response revision is stale')
    }

    // ---- WRITE PHASE ----
    const revision = (existing?.revision ?? 0) + 1
    const response: LessonSurveyResponse = {
      id: surveyResponseId,
      lessonRunId: input.lessonRunId,
      orgId: deps.orgId,
      resultId: input.resultId,
      participantId: input.participantId,
      answers: input.answers,
      revision,
      submittedAt: nowValue,
    }
    tx.set(responsePath, { ...response })
    tx.set(idempotencyPath, { requestDigest, revision })

    return { surveyResponseId, revision, deduplicated: false }
  })
}

/**
 * Production wiring: Firestore Admin SDK. `resolveParticipant` reads
 * `lessonRuns/{lessonRunId}/participants/{participantId}` directly (the
 * same collection `resolveResponseScope` / `resolveActorParticipantId`
 * read elsewhere) — no new collection or RTDB node, per the authorization
 * design documented on `SurveyFirestoreDeps.resolveParticipant`.
 */
export const submitSurveyWithAdminSdk = (
  input: SubmitSurveyInput & { orgId: string },
): Promise<SubmitSurveyResult> => {
  const db = getFirestore()
  const { orgId, ...rest } = input
  return submitSurvey({
    orgId,
    firestore: {
      runTransaction: (fn) => db.runTransaction((tx) => fn({
        get: async (path: string) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
        set: (path: string, data: Record<string, unknown>) => { tx.set(db.doc(path), data) },
      })),
    },
    resolveParticipant: async (lessonRunId, participantId) => {
      const snap = await db.doc(`lessonRuns/${lessonRunId}/participants/${participantId}`).get()
      if (!snap.exists) return undefined
      const data = snap.data() as { orgId: string; status: string }
      return { orgId: data.orgId, status: data.status }
    },
  }, rest)
}

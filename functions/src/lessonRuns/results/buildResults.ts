import { getFirestore } from 'firebase-admin/firestore'
import type { ParticipantId, TeamId } from '@stock-league/lesson-runtime-types'
import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../../lib/idempotency'
import { appendLessonEventInTransaction, type FirestoreTx } from '../appendLessonEvent'
import type { JsonValue, LessonResponse } from '../responses/repository'

// ---------------------------------------------------------------------------
// buildDecisionExplanation (Step 1)
// ---------------------------------------------------------------------------

/**
 * The subset of `LessonEvent` (see appendLessonEvent.ts) this module reads.
 * `AppendLessonEventDeps.type` is a bare `string` — there is no central
 * enum anywhere in functions/src/lessonRuns (checked via `grep -rn "type:
 * '" functions/src/lessonRuns` before writing this: every task defines its
 * own literal `type` strings). This function therefore documents, as its
 * own contract, exactly which `type`/`payload` shapes it understands:
 *
 *  - `RESPONSE_CONFIRMED` — payload `{ responseId, phaseId, inputId,
 *    proxyForParticipantId? }` (confirmResponse.ts). Drives `whatHappened`.
 *  - `PROPOSAL_DECIDED` — payload `{ responseId, decision: 'APPROVE'|
 *    'REJECT', resultingStatus }` (saveResponse.ts's decideProposal).
 *    An `APPROVE` (when no intervention exists) drives `whyItHappened`;
 *    every `REJECT` drives `alternative` (a rejected proposal is exactly
 *    the "alternative that was considered and not chosen").
 *  - `TEACHER_INTERVENTION_APPLIED` — payload `{ interventionType, reason,
 *    ... }` (interventions.ts). Its `reason` takes priority over a plain
 *    APPROVE for `whyItHappened`, since a teacher override is a stronger
 *    causal explanation than "the team approved it".
 *  - `PHASE_CHANGED` — payload `{ previousPhaseId, newPhaseId, reason }`
 *    (phases/transitionPhase.ts). The latest one drives `nextAction`.
 *
 * Any other `type` (PARTICIPANT_JOINED, TEAM_MEMBER_ASSIGNED, ...) is
 * simply not read — it carries no signal this explanation format needs.
 *
 * Deliberately not exhaustive of every event type in the codebase: this is
 * a best-effort explanation over whatever was actually logged, not a full
 * replay/audit tool (LessonRun's `/events` subcollection, teacher-only per
 * firestore.rules, remains the authoritative full record).
 */
export interface DecisionExplanationEvent {
  type: string
  payload: unknown
  actorType: string
  actorId?: string | null
}

export interface DecisionExplanation {
  whatHappened: string
  whyItHappened: string
  alternative: string
  nextAction: string
}

/**
 * The literal fallback text every field uses when this function has no
 * event to point to. Per the task brief: never guess/invent a claim that
 * is not directly backed by a recorded event.
 */
const NO_EVIDENCE = '記録された根拠がありません'

const asRecord = (payload: unknown): Record<string, unknown> =>
  (payload !== null && typeof payload === 'object') ? (payload as Record<string, unknown>) : {}

const stringField = (record: Record<string, unknown>, key: string): string => {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Derives a causal explanation (what happened / why / what the alternative
 * was / what happens next) from a lesson run's free-form event log. See
 * `DecisionExplanationEvent`'s JSDoc for exactly which `type`/`payload`
 * shapes are read. Every field independently falls back to the fixed
 * `NO_EVIDENCE` text rather than inferring anything not directly backed by
 * a matching event — a caller passing an unrelated or empty event list gets
 * four honest "no evidence" strings, never a fabricated narrative.
 */
export const buildDecisionExplanation = (events: DecisionExplanationEvent[]): DecisionExplanation => {
  const confirmed = events.find((event) => event.type === 'RESPONSE_CONFIRMED')
  const intervention = events.find((event) => event.type === 'TEACHER_INTERVENTION_APPLIED')
  const approved = [...events].reverse().find(
    (event) => event.type === 'PROPOSAL_DECIDED' && asRecord(event.payload).decision === 'APPROVE',
  )
  const rejected = events.filter(
    (event) => event.type === 'PROPOSAL_DECIDED' && asRecord(event.payload).decision === 'REJECT',
  )
  const lastPhaseChange = [...events].reverse().find((event) => event.type === 'PHASE_CHANGED')

  const whatHappened = confirmed
    ? `回答(responseId: ${stringField(asRecord(confirmed.payload), 'responseId')})が確定されました。`
    : NO_EVIDENCE

  const interventionReason = intervention ? stringField(asRecord(intervention.payload), 'reason') : ''
  const whyItHappened = intervention && interventionReason
    ? `教師の介入(理由: ${interventionReason})によるものです。`
    : approved
      ? '提案が承認されたためです。'
      : NO_EVIDENCE

  const alternative = rejected.length > 0
    ? `却下された提案があります(responseId: ${rejected.map((event) => stringField(asRecord(event.payload), 'responseId')).join(', ')})。`
    : NO_EVIDENCE

  const nextAction = lastPhaseChange
    ? `次のフェーズ(${stringField(asRecord(lastPhaseChange.payload), 'newPhaseId')})に進みます。`
    : NO_EVIDENCE

  return { whatHappened, whyItHappened, alternative, nextAction }
}

// ---------------------------------------------------------------------------
// LessonResult (Step 3)
// ---------------------------------------------------------------------------

export interface LessonResultResponseSummary {
  responseId: string
  scope: 'participant' | 'team'
  participantId?: ParticipantId
  teamId?: TeamId
  phaseId: string
  inputId: string
  value: JsonValue
  confirmedAt: unknown
  decisionExplanation: DecisionExplanation
}

/**
 * Firestore system of record at `lessonRuns/{lessonRunId}/results/{id}`
 * (already teacher-read-only / server-write-only in firestore.rules — see
 * that file's `match /results/{resultId}` block, predating this task).
 * `externalTaskUrl`/`externalResultUrl` are opaque links a teacher may have
 * configured for the lesson (e.g. a Google Classroom assignment, an
 * external market-result dashboard) — this task only stores/displays them;
 * posting to Classroom automatically is explicitly out of scope (brief
 * Step 4).
 */
export interface LessonResult {
  id: string
  lessonRunId: string
  orgId: string
  phaseId: string
  generatedAt: unknown
  responses: LessonResultResponseSummary[]
  externalTaskUrl?: string
  externalResultUrl?: string
}

export interface BuildLessonResultInput {
  id: string
  lessonRunId: string
  orgId: string
  phaseId: string
  generatedAt: unknown
  responses: LessonResponse[]
  eventsByResponseId: Record<string, DecisionExplanationEvent[]>
  externalTaskUrl?: string
  externalResultUrl?: string
}

/**
 * Pure aggregation: turns a phase's `CONFIRMED` responses plus each
 * response's own event slice into a `LessonResult`. Deliberately takes
 * already-fetched `responses`/`eventsByResponseId` rather than querying
 * Firestore itself — the `FirestoreTx` abstraction this codebase's
 * transactions use (`appendLessonEvent.ts`) only supports `get`-by-path,
 * not arbitrary queries, so the query step lives in
 * `buildAndPersistLessonResult`'s Admin SDK wiring below, outside the
 * transaction, matching how `projections/displayProjection.ts` separates
 * pure shaping from data fetching.
 */
export const buildLessonResult = (input: BuildLessonResultInput): LessonResult => ({
  id: input.id,
  lessonRunId: input.lessonRunId,
  orgId: input.orgId,
  phaseId: input.phaseId,
  generatedAt: input.generatedAt,
  ...(input.externalTaskUrl ? { externalTaskUrl: input.externalTaskUrl } : {}),
  ...(input.externalResultUrl ? { externalResultUrl: input.externalResultUrl } : {}),
  responses: input.responses
    .filter((response) => response.status === 'CONFIRMED')
    .map((response) => ({
      responseId: response.id,
      scope: response.teamId ? ('team' as const) : ('participant' as const),
      ...(response.participantId ? { participantId: response.participantId } : {}),
      ...(response.teamId ? { teamId: response.teamId } : {}),
      phaseId: response.phaseId,
      inputId: response.inputId,
      value: response.value as JsonValue,
      confirmedAt: response.confirmedAt ?? null,
      decisionExplanation: buildDecisionExplanation(input.eventsByResponseId[response.id] ?? []),
    })),
})

const deriveResultId = (lessonRunId: string, phaseId: string): string =>
  idempotencyDocumentId(lessonRunId, `result:${phaseId}`)

export interface BuildAndPersistLessonResultDeps {
  firestore: { runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => Promise<T> }
  /** Non-transactional Admin SDK query (see `buildLessonResult`'s JSDoc for why). */
  queryConfirmedResponses: (lessonRunId: string, phaseId: string) => Promise<LessonResponse[]>
  queryEventsForResponse: (lessonRunId: string, responseId: string) => Promise<DecisionExplanationEvent[]>
  actorId: string
  now?: () => unknown
}

export interface BuildAndPersistLessonResultInput {
  lessonRunId: string
  orgId: string
  phaseId: string
  externalTaskUrl?: string
  externalResultUrl?: string
  idempotencyKey: string
}

export interface BuildAndPersistLessonResultResult {
  resultId: string
  result: LessonResult
  deduplicated: boolean
}

/**
 * Query phase (outside the transaction) then persist (read-idempotency,
 * then write-only inside the transaction — no read ever follows a write,
 * per this codebase's established read-then-write transaction discipline).
 * `resultId` is deterministic (`lessonRunId` + `phaseId`) so re-running
 * this for the same phase always targets the same document; the
 * idempotency doc additionally guards against two concurrent calls with
 * different `idempotencyKey`s racing to build the same result from
 * different response snapshots.
 */
export const buildAndPersistLessonResult = async (
  deps: BuildAndPersistLessonResultDeps,
  input: BuildAndPersistLessonResultInput,
): Promise<BuildAndPersistLessonResultResult> => {
  const responses = await deps.queryConfirmedResponses(input.lessonRunId, input.phaseId)
  const eventsByResponseId: Record<string, DecisionExplanationEvent[]> = {}
  for (const response of responses) {
    eventsByResponseId[response.id] = await deps.queryEventsForResponse(input.lessonRunId, response.id)
  }

  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  const resultId = deriveResultId(input.lessonRunId, input.phaseId)
  const resultPath = `lessonRuns/${input.lessonRunId}/results/${resultId}`
  const idempotencyPath = `${resultPath}/generateIdempotency/${idempotencyDocumentId(resultId, input.idempotencyKey)}`
  const requestDigest = computeRequestDigest({
    responseIds: responses.map((response) => response.id).sort(),
    externalTaskUrl: input.externalTaskUrl ?? null,
    externalResultUrl: input.externalResultUrl ?? null,
  })

  return deps.firestore.runTransaction(async (tx) => {
    // ---- READ PHASE ----
    const existing = await tx.get(idempotencyPath)
    if (existing.exists) {
      const prior = existing.data() as { requestDigest: string; result: LessonResult }
      if (prior.requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
      return { resultId, result: prior.result, deduplicated: true }
    }

    // ---- WRITE PHASE ----
    const result = buildLessonResult({
      id: resultId, lessonRunId: input.lessonRunId, orgId: input.orgId, phaseId: input.phaseId,
      generatedAt: nowValue, responses, eventsByResponseId,
      externalTaskUrl: input.externalTaskUrl, externalResultUrl: input.externalResultUrl,
    })

    await appendLessonEventInTransaction(tx, {
      lessonRunId: input.lessonRunId,
      orgId: input.orgId,
      type: 'LESSON_RESULT_GENERATED',
      actorType: 'SYSTEM',
      actorId: deps.actorId,
      payload: { resultId, phaseId: input.phaseId, responseCount: result.responses.length },
      idempotencyKey: input.idempotencyKey,
    }, nowValue)

    tx.set(resultPath, { ...result })
    tx.set(idempotencyPath, { requestDigest, result })

    return { resultId, result, deduplicated: false }
  })
}

/** Production wiring: Firestore Admin SDK. No Callable wraps this directly (matches appendLessonEventWithAdminSdk's reasoning) — a future teacher-facing "generate results" Callable, or the REFLECTION-phase transition itself, calls this after it has already authorized the request. */
export const buildAndPersistLessonResultWithAdminSdk = (
  input: Omit<BuildAndPersistLessonResultInput, never> & { actorId: string },
): Promise<BuildAndPersistLessonResultResult> => {
  const db = getFirestore()
  const { actorId, ...rest } = input
  return buildAndPersistLessonResult({
    firestore: {
      runTransaction: (fn) => db.runTransaction((tx) => fn({
        get: async (path: string) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
        set: (path: string, data: Record<string, unknown>) => { tx.set(db.doc(path), data) },
      })),
    },
    queryConfirmedResponses: async (lessonRunId, phaseId) => {
      const snap = await db.collection(`lessonRuns/${lessonRunId}/responses`)
        .where('phaseId', '==', phaseId).where('status', '==', 'CONFIRMED').get()
      return snap.docs.map((doc) => doc.data() as unknown as LessonResponse)
    },
    queryEventsForResponse: async (lessonRunId, responseId) => {
      const snap = await db.collection(`lessonRuns/${lessonRunId}/events`).orderBy('sequence').get()
      return snap.docs
        .map((doc) => doc.data() as unknown as { type: string; payload: unknown; actorType: string; actorId?: string | null })
        .filter((event) => asRecord(event.payload).responseId === responseId)
    },
    actorId,
  }, rest)
}

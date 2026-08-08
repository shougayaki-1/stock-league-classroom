import { getFirestore } from 'firebase-admin/firestore'
import type { ParticipantId } from '@stock-league/lesson-runtime-types'
import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../../lib/idempotency'
import { appendLessonEventInTransaction, type FirestoreTx } from '../appendLessonEvent'
import { canConfirmTeamResponse } from '../teams/repository'
import { deriveResponseId, type LessonResponse, type LessonResponseStatus } from './repository'
import { resolveResponseScope, type ResponseFirestoreDeps, type ResponseScopeInput } from './saveResponse'

export interface ConfirmResponseInput extends ResponseScopeInput {
  idempotencyKey: string
}
export interface ConfirmResponseResult {
  responseId: string
  status: LessonResponseStatus
  confirmedAt: unknown
  deduplicated: boolean
}

/**
 * `APPROVED` -> `CONFIRMED`, the final step of the response state machine.
 * Rejects:
 *
 *  - anything other than `APPROVED` (covers quorum-not-reached: decideProposal
 *    only ever advances a QUORUM/ALL team response to `APPROVED` once enough
 *    approvals are in, so a response still short of quorum is still
 *    `PROPOSED` and is rejected here with the same error as any other
 *    not-yet-approved response);
 *  - a non-member of the response's team (§ "別チーム操作");
 *  - a team member who is not eligible to confirm per `canConfirmTeamResponse`
 *    — in REPRESENTATIVE mode, only the representative (§ "代表者でない確定").
 *
 * PROXY_CONFIRM (Task 9's teacher-intervention "代理確定") extension point:
 * `deps.actorType` defaults to `'STUDENT'` (every pre-Task-9 call site is
 * unaffected) but a caller may pass `'TEACHER'` together with
 * `deps.proxyForParticipantId` to record that a teacher confirmed *on behalf
 * of* the named participant — `deps.actorParticipantId` still has to satisfy
 * the same `canConfirmTeamResponse`/individual-ownership authorization gate
 * below (the caller resolves which participant identity legitimizes the
 * confirm; this function does not special-case "is this actually a
 * teacher-proxied call" for authorization purposes, only for what gets
 * written to the audit event). `proxyForParticipantId` is recorded on both
 * the `RESPONSE_CONFIRMED` event payload and the response doc itself, so the
 * proxy nature of the confirm survives in the result history that Task 9's
 * brief requires, not just in the transient function call.
 */
export const confirmResponse = async (
  deps: ResponseFirestoreDeps,
  input: ConfirmResponseInput,
): Promise<ConfirmResponseResult> => {
  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  const responseId = deriveResponseId(String(input.teamId ?? input.participantId), input.phaseId, input.inputId)
  const responsePath = `lessonRuns/${input.lessonRunId}/responses/${responseId}`
  const idempotencyPath = `${responsePath}/confirmIdempotency/${idempotencyDocumentId(responseId, input.idempotencyKey)}`
  const requestDigest = computeRequestDigest({})

  return deps.firestore.runTransaction(async (tx) => {
    // ---- READ PHASE ----
    const existingIdempotency = await tx.get(idempotencyPath)
    if (existingIdempotency.exists) {
      const prior = existingIdempotency.data() as { requestDigest: string; status: LessonResponseStatus; confirmedAt: unknown }
      if (prior.requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
      return { responseId, status: prior.status, confirmedAt: prior.confirmedAt, deduplicated: true }
    }

    const { orgId, team } = await resolveResponseScope(tx, input, deps.actorParticipantId)

    const responseSnap = await tx.get(responsePath)
    if (!responseSnap.exists) throw new Error('Response not found')
    const response = responseSnap.data() as unknown as LessonResponse
    if (response.status === 'CONFIRMED') throw new Error('Response has already been confirmed')
    if (response.status !== 'APPROVED') throw new Error('Response has not been approved and cannot be confirmed')

    if (team && !canConfirmTeamResponse(team, deps.actorParticipantId)) {
      throw new Error('Only the team representative may confirm this response')
    }

    // ---- WRITE PHASE ----
    await appendLessonEventInTransaction(tx, {
      lessonRunId: input.lessonRunId,
      orgId,
      type: 'RESPONSE_CONFIRMED',
      actorType: deps.actorType ?? 'STUDENT',
      actorId: deps.actorId,
      payload: {
        responseId, phaseId: input.phaseId, inputId: input.inputId,
        ...(deps.proxyForParticipantId ? { proxyForParticipantId: deps.proxyForParticipantId } : {}),
      },
      idempotencyKey: `${responseId}:${input.idempotencyKey}`,
    }, nowValue)

    const updated: LessonResponse = {
      ...response, status: 'CONFIRMED', confirmedAt: nowValue,
      ...(deps.proxyForParticipantId ? { proxyConfirmedForParticipantId: deps.proxyForParticipantId } : {}),
    }
    tx.set(responsePath, { ...updated })
    tx.set(idempotencyPath, { requestDigest, status: 'CONFIRMED', confirmedAt: nowValue })

    return { responseId, status: 'CONFIRMED' as const, confirmedAt: nowValue, deduplicated: false }
  })
}

/** Production wiring: Firestore Admin SDK transaction adapter, matching saveResponse.ts. */
const adminSdkFirestore = () => {
  const db = getFirestore()
  return {
    runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => db.runTransaction((tx) => fn({
      get: async (path: string) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
      set: (path: string, data: Record<string, unknown>) => { tx.set(db.doc(path), data) },
    })),
  }
}

export const confirmResponseWithAdminSdk = (
  input: ConfirmResponseInput & {
    actorId: string
    actorParticipantId: ParticipantId
    actorType?: 'STUDENT' | 'TEACHER'
    proxyForParticipantId?: ParticipantId
  },
): Promise<ConfirmResponseResult> => {
  const { actorId, actorParticipantId, actorType, proxyForParticipantId, ...rest } = input
  return confirmResponse({ firestore: adminSdkFirestore(), actorId, actorParticipantId, actorType, proxyForParticipantId }, rest)
}

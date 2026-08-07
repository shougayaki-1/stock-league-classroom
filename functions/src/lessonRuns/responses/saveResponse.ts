import { getFirestore } from 'firebase-admin/firestore'
import type { ParticipantId, TeamId } from '@stock-league/lesson-runtime-types'
import type { LessonInputValue } from '@stock-league/lesson-inputs'
import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../../lib/idempotency'
import { appendLessonEventInTransaction, type FirestoreTx } from '../appendLessonEvent'
import type { LessonParticipant } from '../participants/repository'
import { canConfirmTeamResponse, type LessonTeam } from '../teams/repository'
import { deriveResponseId, type JsonValue, type LessonResponse, type LessonResponseStatus } from './repository'

export interface ResponseFirestoreDeps {
  firestore: { runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => Promise<T> }
  /** Verified auth uid — recorded as the event log's `actorId`, matching every other STUDENT-actor flow (joinLessonRun.ts). */
  actorId: string
  /** The participant identity of the caller, resolved server-side (onCall.ts) before this pure layer runs — never trusted from client input, matching how teams/assignTeam.ts's `deps.actorId` is always server-resolved. */
  actorParticipantId: ParticipantId
  now?: () => unknown
  /**
   * Phase C extension point (see repository.ts's `contextSnapshot` JSDoc):
   * resolves optional subject-specific context (e.g. a reference price) to
   * attach to a submitted proposal. Defaults to an empty object — Phase B
   * has no subject adapter of its own.
   */
  resolveContextSnapshot?: (input: { lessonRunId: string; phaseId: string; inputId: string }) => Promise<Record<string, JsonValue>>
}

export interface ResponseScopeInput {
  lessonRunId: string
  participantId?: ParticipantId
  teamId?: TeamId
  phaseId: string
  inputId: string
}

const validateScope = (input: ResponseScopeInput): void => {
  if (input.participantId && input.teamId) {
    throw new Error('participantId and teamId cannot both be specified')
  }
  if (!input.participantId && !input.teamId) {
    throw new Error('Either participantId or teamId is required')
  }
}

/**
 * Resolves the response's owning scope (individual participant or team),
 * authorizing that `actorParticipantId` may act within it, and returns the
 * `orgId` the scope belongs to. Called during the READ PHASE of every
 * response transaction in this file and in confirmResponse.ts — every
 * `tx.get` it performs must (and does) happen before any `tx.set`.
 *
 * Team membership (not `canConfirmTeamResponse`) is the bar for
 * saveResponseDraft/submitProposal/decideProposal: any team member may draft
 * or propose collaboratively. `canConfirmTeamResponse`'s stricter
 * REPRESENTATIVE-only gate is applied on top of this, only where the brief
 * requires it (decideProposal's approve/reject, and confirmResponse).
 */
export const resolveResponseScope = async (
  tx: FirestoreTx,
  input: ResponseScopeInput,
  actorParticipantId: ParticipantId,
): Promise<{ orgId: string; team?: LessonTeam }> => {
  validateScope(input)
  if (input.teamId) {
    const teamSnap = await tx.get(`lessonRuns/${input.lessonRunId}/teams/${input.teamId}`)
    if (!teamSnap.exists) throw new Error('Team not found')
    const team = teamSnap.data() as unknown as LessonTeam
    if (!team.memberParticipantIds.includes(actorParticipantId)) {
      throw new Error('Participant is not a member of this team')
    }
    return { orgId: team.orgId, team }
  }
  const participantSnap = await tx.get(`lessonRuns/${input.lessonRunId}/participants/${input.participantId}`)
  if (!participantSnap.exists) throw new Error('Participant not found')
  const participant = participantSnap.data() as unknown as LessonParticipant
  if (participant.id !== actorParticipantId) {
    throw new Error('Participant cannot act on another participant\'s response')
  }
  return { orgId: participant.orgId }
}

const buildResponsePath = (lessonRunId: string, responseId: string): string => `lessonRuns/${lessonRunId}/responses/${responseId}`

export interface SaveResponseDraftInput extends ResponseScopeInput {
  value: LessonInputValue
  rationaleInformationIds?: string[]
  /** The revision the client last saw. Required whenever a response doc already exists — a mismatch (or omission) is rejected as a stale overwrite. Not required for the very first save. */
  expectedRevision?: number
  idempotencyKey: string
}
export interface SaveResponseDraftResult {
  responseId: string
  revision: number
  status: LessonResponseStatus
  deduplicated: boolean
}

/**
 * `DRAFT`-state autosave. Callable any number of times; only the exact same
 * `idempotencyKey` is deduplicated (a genuinely new autosave attempt always
 * uses a fresh key, per the client hook's design — useLessonResponseDraft.ts).
 *
 * Editing after `CONFIRMED` is rejected outright (task-7-brief's first
 * required reject case). Editing while `PROPOSED`/`APPROVED`/`REJECTED`
 * resets the response back to `DRAFT` with `approvals: []`, since a changed
 * value invalidates whatever proposal/decision round was in progress.
 *
 * NOTE on `LessonInputValue` validation (`@stock-league/lesson-inputs`'s
 * `validateLessonInput`, imported above only as a type): this layer
 * deliberately does not call it. `validateLessonInput` needs the input's
 * `LessonInputConfig` (its widget type, options, min/max, etc.) to check a
 * value against, and that config lives in the lesson template/version
 * (functions/src/lessonTemplates) keyed by phase/input id — Phase B's
 * response layer here is only ever given `phaseId`/`inputId` strings, with
 * no lookup path from those back to the template's per-input config (no
 * lessonRun -> lessonVersion -> phase -> input config resolver exists yet
 * anywhere in functions/src). Wiring that up is a template-repository
 * change, not a one-line addition here, and is out of scope for Task 7.
 * Until it exists, this is a known, intentional gap: a malformed `value`
 * (wrong shape/out of range/etc.) is accepted and stored as-is, exactly
 * like `rationaleInformationIds` and `contextSnapshot` are today. It is
 * bounded by the same `deny-by-default` Firestore rules and Callable-only
 * write path as everything else in this file — a malformed value cannot be
 * written directly to Firestore, only through this validated-elsewhere
 * Callable — so the risk is display/consumption of an odd value, not an
 * integrity or security hole. Revisit once a template/input-config
 * resolver exists for the server side.
 */
export const saveResponseDraft = async (
  deps: ResponseFirestoreDeps,
  input: SaveResponseDraftInput,
): Promise<SaveResponseDraftResult> => {
  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  const responseId = deriveResponseId(String(input.teamId ?? input.participantId), input.phaseId, input.inputId)
  const responsePath = buildResponsePath(input.lessonRunId, responseId)
  const idempotencyPath = `${responsePath}/saveDraftIdempotency/${idempotencyDocumentId(responseId, input.idempotencyKey)}`
  const requestDigest = computeRequestDigest({
    value: input.value,
    rationaleInformationIds: input.rationaleInformationIds ?? [],
    expectedRevision: input.expectedRevision ?? null,
  })

  return deps.firestore.runTransaction(async (tx) => {
    // ---- READ PHASE ----
    const existingIdempotency = await tx.get(idempotencyPath)
    if (existingIdempotency.exists) {
      const prior = existingIdempotency.data() as { requestDigest: string; revision: number; status: LessonResponseStatus }
      if (prior.requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
      return { responseId, revision: prior.revision, status: prior.status, deduplicated: true }
    }

    const { orgId } = await resolveResponseScope(tx, input, deps.actorParticipantId)

    const existingSnap = await tx.get(responsePath)
    const existing = existingSnap.exists ? (existingSnap.data() as unknown as LessonResponse) : undefined
    if (existing?.status === 'CONFIRMED') {
      throw new Error('Response has already been confirmed and cannot be edited')
    }
    if (existing && input.expectedRevision !== existing.revision) {
      throw new Error('Response revision is stale')
    }

    // ---- WRITE PHASE ----
    await appendLessonEventInTransaction(tx, {
      lessonRunId: input.lessonRunId,
      orgId,
      type: 'RESPONSE_SAVED',
      actorType: 'STUDENT',
      actorId: deps.actorId,
      payload: { responseId, phaseId: input.phaseId, inputId: input.inputId },
      idempotencyKey: `${responseId}:${input.idempotencyKey}`,
    }, nowValue)

    const newRevision = (existing?.revision ?? 0) + 1
    const response: LessonResponse = {
      id: responseId,
      lessonRunId: input.lessonRunId,
      orgId,
      ...(input.participantId ? { participantId: input.participantId } : {}),
      ...(input.teamId ? { teamId: input.teamId } : {}),
      phaseId: input.phaseId,
      inputId: input.inputId,
      value: input.value,
      status: 'DRAFT',
      revision: newRevision,
      rationaleInformationIds: input.rationaleInformationIds ?? [],
      approvals: [],
      contextSnapshot: existing?.contextSnapshot ?? {},
    }
    tx.set(responsePath, { ...response })
    tx.set(idempotencyPath, { requestDigest, revision: newRevision, status: 'DRAFT' })

    return { responseId, revision: newRevision, status: 'DRAFT' as const, deduplicated: false }
  })
}

export interface SubmitProposalInput extends ResponseScopeInput {
  expectedRevision: number
  idempotencyKey: string
}
export interface SubmitProposalResult {
  responseId: string
  revision: number
  status: LessonResponseStatus
  deduplicated: boolean
}

/** `DRAFT` -> `PROPOSED`. Requires a saved draft at exactly `expectedRevision` (same stale-revision guard as saveResponseDraft). */
export const submitProposal = async (
  deps: ResponseFirestoreDeps,
  input: SubmitProposalInput,
): Promise<SubmitProposalResult> => {
  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  const responseId = deriveResponseId(String(input.teamId ?? input.participantId), input.phaseId, input.inputId)
  const responsePath = buildResponsePath(input.lessonRunId, responseId)
  const idempotencyPath = `${responsePath}/submitProposalIdempotency/${idempotencyDocumentId(responseId, input.idempotencyKey)}`
  const requestDigest = computeRequestDigest({ expectedRevision: input.expectedRevision })

  return deps.firestore.runTransaction(async (tx) => {
    // ---- READ PHASE ----
    const existingIdempotency = await tx.get(idempotencyPath)
    if (existingIdempotency.exists) {
      const prior = existingIdempotency.data() as { requestDigest: string; revision: number; status: LessonResponseStatus }
      if (prior.requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
      return { responseId, revision: prior.revision, status: prior.status, deduplicated: true }
    }

    const { orgId } = await resolveResponseScope(tx, input, deps.actorParticipantId)

    const responseSnap = await tx.get(responsePath)
    if (!responseSnap.exists) throw new Error('Response not found')
    const response = responseSnap.data() as unknown as LessonResponse
    if (response.status === 'CONFIRMED') throw new Error('Response has already been confirmed and cannot be edited')
    if (response.status !== 'DRAFT') throw new Error('Response must be in DRAFT status to submit a proposal')
    if (input.expectedRevision !== response.revision) throw new Error('Response revision is stale')

    const contextSnapshot = deps.resolveContextSnapshot
      ? await deps.resolveContextSnapshot({ lessonRunId: input.lessonRunId, phaseId: input.phaseId, inputId: input.inputId })
      : {}

    // ---- WRITE PHASE ----
    await appendLessonEventInTransaction(tx, {
      lessonRunId: input.lessonRunId,
      orgId,
      type: 'PROPOSAL_SUBMITTED',
      actorType: 'STUDENT',
      actorId: deps.actorId,
      payload: { responseId, phaseId: input.phaseId, inputId: input.inputId },
      idempotencyKey: `${responseId}:${input.idempotencyKey}`,
    }, nowValue)

    const updated: LessonResponse = { ...response, status: 'PROPOSED', approvals: [], contextSnapshot }
    tx.set(responsePath, { ...updated })
    tx.set(idempotencyPath, { requestDigest, revision: updated.revision, status: 'PROPOSED' })

    return { responseId, revision: updated.revision, status: 'PROPOSED' as const, deduplicated: false }
  })
}

export interface DecideProposalInput extends ResponseScopeInput {
  decision: 'APPROVE' | 'REJECT'
  idempotencyKey: string
}
export interface DecideProposalResult {
  responseId: string
  status: LessonResponseStatus
  approvals: ParticipantId[]
  deduplicated: boolean
}

/**
 * `PROPOSED` -> `APPROVED`/`REJECTED`. This is where the QUORUM aggregation
 * lives (see repository.ts's `approvals` JSDoc and task-7-report.md for the
 * full design rationale):
 *
 *  - Individual scope: the participant decides their own proposal directly.
 *  - REPRESENTATIVE team: only the representative may decide
 *    (`canConfirmTeamResponse`); their single decision is final.
 *  - ALL team: any reject is immediately final (`REJECTED`); an approve is
 *    recorded in `approvals` and the response becomes `APPROVED` only once
 *    every member has approved.
 *  - QUORUM team: same reject-is-immediate rule; an approve is recorded and
 *    the response becomes `APPROVED` once `approvals.length` reaches
 *    `team.requiredApprovalCount` (falling back to full membership if unset).
 */
export const decideProposal = async (
  deps: ResponseFirestoreDeps,
  input: DecideProposalInput,
): Promise<DecideProposalResult> => {
  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  const responseId = deriveResponseId(String(input.teamId ?? input.participantId), input.phaseId, input.inputId)
  const responsePath = buildResponsePath(input.lessonRunId, responseId)
  const idempotencyPath = `${responsePath}/decideProposalIdempotency/${idempotencyDocumentId(responseId, input.idempotencyKey)}`
  const requestDigest = computeRequestDigest({ decision: input.decision })

  return deps.firestore.runTransaction(async (tx) => {
    // ---- READ PHASE ----
    const existingIdempotency = await tx.get(idempotencyPath)
    if (existingIdempotency.exists) {
      const prior = existingIdempotency.data() as {
        requestDigest: string
        status: LessonResponseStatus
        approvals: ParticipantId[]
      }
      if (prior.requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
      return { responseId, status: prior.status, approvals: prior.approvals, deduplicated: true }
    }

    const { orgId, team } = await resolveResponseScope(tx, input, deps.actorParticipantId)

    const responseSnap = await tx.get(responsePath)
    if (!responseSnap.exists) throw new Error('Response not found')
    const response = responseSnap.data() as unknown as LessonResponse
    if (response.status !== 'PROPOSED') throw new Error('Response must be in PROPOSED status to decide')

    if (team && !canConfirmTeamResponse(team, deps.actorParticipantId)) {
      throw new Error('Participant is not authorized to decide this team\'s response')
    }

    // ---- WRITE PHASE ----
    let nextStatus: LessonResponseStatus
    let nextApprovals: ParticipantId[]
    if (input.decision === 'REJECT') {
      nextStatus = 'REJECTED'
      nextApprovals = response.approvals
    } else if (!team) {
      // Individual scope: a single decision is always final.
      nextStatus = 'APPROVED'
      nextApprovals = [deps.actorParticipantId]
    } else if (team.confirmationMode === 'REPRESENTATIVE') {
      nextStatus = 'APPROVED'
      nextApprovals = [deps.actorParticipantId]
    } else {
      const merged = response.approvals.includes(deps.actorParticipantId)
        ? response.approvals
        : [...response.approvals, deps.actorParticipantId]
      const requiredCount = team.confirmationMode === 'QUORUM'
        ? (team.requiredApprovalCount ?? team.memberParticipantIds.length)
        : team.memberParticipantIds.length
      nextStatus = merged.length >= requiredCount ? 'APPROVED' : 'PROPOSED'
      nextApprovals = merged
    }

    await appendLessonEventInTransaction(tx, {
      lessonRunId: input.lessonRunId,
      orgId,
      type: 'PROPOSAL_DECIDED',
      actorType: 'STUDENT',
      actorId: deps.actorId,
      payload: { responseId, decision: input.decision, resultingStatus: nextStatus },
      idempotencyKey: `${responseId}:${input.idempotencyKey}`,
    }, nowValue)

    const updated: LessonResponse = { ...response, status: nextStatus, approvals: nextApprovals }
    tx.set(responsePath, { ...updated })
    tx.set(idempotencyPath, { requestDigest, status: nextStatus, approvals: nextApprovals })

    return { responseId, status: nextStatus, approvals: nextApprovals, deduplicated: false }
  })
}

/** Production wiring: Firestore Admin SDK transaction adapter, matching teams/assignTeam.ts. */
const adminSdkFirestore = () => {
  const db = getFirestore()
  return {
    runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => db.runTransaction((tx) => fn({
      get: async (path: string) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
      set: (path: string, data: Record<string, unknown>) => { tx.set(db.doc(path), data) },
    })),
  }
}

export const saveResponseDraftWithAdminSdk = (
  input: SaveResponseDraftInput & { actorId: string; actorParticipantId: ParticipantId },
): Promise<SaveResponseDraftResult> => {
  const { actorId, actorParticipantId, ...rest } = input
  return saveResponseDraft({ firestore: adminSdkFirestore(), actorId, actorParticipantId }, rest)
}

export const submitProposalWithAdminSdk = (
  input: SubmitProposalInput & {
    actorId: string
    actorParticipantId: ParticipantId
    resolveContextSnapshot?: ResponseFirestoreDeps['resolveContextSnapshot']
  },
): Promise<SubmitProposalResult> => {
  const { actorId, actorParticipantId, resolveContextSnapshot, ...rest } = input
  return submitProposal({ firestore: adminSdkFirestore(), actorId, actorParticipantId, resolveContextSnapshot }, rest)
}

export const decideProposalWithAdminSdk = (
  input: DecideProposalInput & { actorId: string; actorParticipantId: ParticipantId },
): Promise<DecideProposalResult> => {
  const { actorId, actorParticipantId, ...rest } = input
  return decideProposal({ firestore: adminSdkFirestore(), actorId, actorParticipantId }, rest)
}

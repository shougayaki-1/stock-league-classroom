import { getFirestore } from 'firebase-admin/firestore'
import type { LessonRunRole, ParticipantId, TeamId } from '@stock-league/lesson-runtime-types'
import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../lib/idempotency'
import { appendLessonEventInTransaction, type FirestoreTx } from './appendLessonEvent'
import { canControlLesson } from './authorization'
import { confirmResponseWithAdminSdk } from './responses/confirmResponse'
import { issueRecoveryCodeWithAdminSdk, recoverParticipantWithAdminSdk } from './recovery'
import { noopSubjectLifecycleAdapter, type SubjectLifecycleAdapter } from './recoveryLifecycle'
import type { LessonRunStatus } from './phases/stateMachine'
import { transitionPhaseWithAdminSdk } from './phases/transitionPhase'
import { rotateRepresentativeWithAdminSdk } from './teams/assignTeam'

// ---------------------------------------------------------------------------
// transferPrimaryTeacher
// ---------------------------------------------------------------------------

export interface TransferPrimaryTeacherInput {
  lessonRunId: string
  /** Verified auth uid of the caller — resolved server-side (onCall.ts), never trusted from client input, matching every other lessonRuns Callable. */
  callerUid: string
  newPrimaryTeacherUid: string
  reason: string
  idempotencyKey: string
}

export interface TransferPrimaryTeacherResult {
  previousPrimaryTeacherUid: string
  newPrimaryTeacherUid: string
  deduplicated: boolean
}

interface StoredTransfer {
  requestDigest: string
  previousPrimaryTeacherUid: string
  newPrimaryTeacherUid: string
}

/**
 * §6.5 "授業のホストは端末に固定しない": handing off the PRIMARY role is a
 * pure `LessonRun.teacherRoles` map update, gated by re-using
 * `authorization.ts`'s existing `TRANSFER_PRIMARY` action (PRIMARY-only) via
 * `canControlLesson` — no new permission table is introduced for this, per
 * the task brief's explicit instruction. This function is deliberately
 * self-checking (unlike most other lessonRuns/ pure functions, which trust
 * the onCall layer's authorization gate): Task 9's brief specifically asks
 * for a *failing test* that the business rule itself ("only the primary
 * teacher may transfer") rejects an unauthorized caller, so the check lives
 * here rather than only in interventions/onCall.ts's Callable wrapper.
 *
 * Nothing here reads or writes any device/session/host-lease concept — the
 * function only ever touches `lessonRuns/{lessonRunId}` and its own
 * event/idempotency subpaths (see interventions.test.ts's "does not
 * reference any device/host-lease concept" regression test), confirming
 * this codebase has no such concept to begin with and this operation does
 * not need one.
 *
 * READ PHASE (idempotency doc, then the LessonRun doc) completes before any
 * write, matching the read-before-write discipline established after Task
 * 3's Critical #1 (see joinLessonRun.ts / teams/assignTeam.ts).
 * `appendLessonEventInTransaction` — itself get-then-set — runs before this
 * function's own `tx.set` calls.
 */
export const transferPrimaryTeacher = async (
  deps: { firestore: { runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => Promise<T> }; now?: () => unknown },
  input: TransferPrimaryTeacherInput,
): Promise<TransferPrimaryTeacherResult> => {
  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  const idempotencyPath = `lessonRuns/${input.lessonRunId}/transferPrimaryIdempotency/${idempotencyDocumentId(input.lessonRunId, input.idempotencyKey)}`
  const requestDigest = computeRequestDigest({
    callerUid: input.callerUid, newPrimaryTeacherUid: input.newPrimaryTeacherUid, reason: input.reason,
  })

  return deps.firestore.runTransaction(async (tx) => {
    // ---- READ PHASE ----
    const existingIdempotency = await tx.get(idempotencyPath)
    if (existingIdempotency.exists) {
      const prior = existingIdempotency.data() as unknown as StoredTransfer
      if (prior.requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
      return { previousPrimaryTeacherUid: prior.previousPrimaryTeacherUid, newPrimaryTeacherUid: prior.newPrimaryTeacherUid, deduplicated: true }
    }

    const runPath = `lessonRuns/${input.lessonRunId}`
    const runSnap = await tx.get(runPath)
    if (!runSnap.exists) throw new Error('LessonRun not found')
    const run = runSnap.data() as Record<string, unknown> & { orgId: string; teacherRoles?: Record<string, LessonRunRole> }
    const teacherRoles = run.teacherRoles ?? {}

    const callerRole = teacherRoles[input.callerUid]
    if (!callerRole || !canControlLesson(callerRole, 'TRANSFER_PRIMARY')) {
      throw new Error('Only the primary teacher may transfer the primary role')
    }
    if (teacherRoles[input.newPrimaryTeacherUid] !== 'ASSISTANT') {
      throw new Error('The new primary teacher must currently be an active assistant on this run')
    }

    // ---- WRITE PHASE ----
    const newTeacherRoles: Record<string, LessonRunRole> = {
      ...teacherRoles, [input.callerUid]: 'ASSISTANT', [input.newPrimaryTeacherUid]: 'PRIMARY',
    }
    await appendLessonEventInTransaction(tx, {
      lessonRunId: input.lessonRunId,
      orgId: run.orgId,
      type: 'PRIMARY_TEACHER_TRANSFERRED',
      actorType: 'TEACHER',
      actorId: input.callerUid,
      payload: {
        previousPrimaryTeacherUid: input.callerUid,
        newPrimaryTeacherUid: input.newPrimaryTeacherUid,
        reason: input.reason,
      },
      idempotencyKey: `transfer:${input.idempotencyKey}`,
    }, nowValue)

    tx.set(runPath, { ...run, teacherRoles: newTeacherRoles, primaryTeacherUid: input.newPrimaryTeacherUid })
    const stored: StoredTransfer = { requestDigest, previousPrimaryTeacherUid: input.callerUid, newPrimaryTeacherUid: input.newPrimaryTeacherUid }
    tx.set(idempotencyPath, stored as unknown as Record<string, unknown>)

    return { previousPrimaryTeacherUid: input.callerUid, newPrimaryTeacherUid: input.newPrimaryTeacherUid, deduplicated: false }
  })
}

/** Production wiring: Firestore Admin SDK transaction adapter, matching every other lessonRuns/ file. */
const adminSdkFirestore = () => {
  const db = getFirestore()
  return {
    runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => db.runTransaction((tx) => fn({
      get: async (path: string) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
      set: (path: string, data: Record<string, unknown>) => { tx.set(db.doc(path), data) },
    })),
  }
}

export const transferPrimaryTeacherWithAdminSdk = (
  input: TransferPrimaryTeacherInput,
): Promise<TransferPrimaryTeacherResult> => transferPrimaryTeacher({ firestore: adminSdkFirestore() }, input)

// ---------------------------------------------------------------------------
// applyTeacherIntervention
// ---------------------------------------------------------------------------

/**
 * §6.5's 9 mid-lesson teacher interventions (this task's own enumeration —
 * §6.5 does not spell out this exact breakdown, see interventions.ts's
 * dispatch prompt / task-9-report.md for the reasoning behind each type).
 * `EXTEND_TIME` intentionally duplicates the *name* of an existing
 * `LessonControlAction` (authorization.ts) but not its permission logic —
 * see `interventionPermissions` below for how the duplication is resolved.
 */
export const lessonInterventionTypes = [
  'EXTEND_TIME',
  'PROXY_CONFIRM',
  'CHANGE_REPRESENTATIVE',
  'RECONNECT_PARTICIPANT',
  'SWITCH_DISPLAY_SLIDE',
  'CORRECT_STATE',
  'RESTORE_PREVIOUS_PHASE',
  'EMERGENCY_STOP',
  'HIDE_INFORMATION',
] as const

export type LessonInterventionType = (typeof lessonInterventionTypes)[number]

export type InterventionImpactScope =
  | { level: 'PARTICIPANT'; participantId: ParticipantId }
  | { level: 'TEAM'; teamId: TeamId }
  | { level: 'LESSON' }

/**
 * Permission table for the 8 intervention types that are NOT `EXTEND_TIME`
 * (see `canApplyIntervention` below for how `EXTEND_TIME` is handled
 * separately). Design judgment (§6.5 does not enumerate these — see this
 * task's dispatch prompt):
 *
 *  - PRIMARY-only: `CORRECT_STATE` (an unchecked manual state edit — the
 *    highest-risk intervention, since it has no domain-specific safety net),
 *    `RESTORE_PREVIOUS_PHASE` (touches overall lesson progression, same
 *    single-decision-point reasoning `authorization.ts` already applies to
 *    `TRANSITION_PHASE`), and `EMERGENCY_STOP` (same tier as `STOP_MARKET`).
 *  - PRIMARY + ASSISTANT: `PROXY_CONFIRM`, `CHANGE_REPRESENTATIVE`,
 *    `RECONNECT_PARTICIPANT` mirror the existing `SUPPORT_STUDENT`/
 *    `HANDLE_CONNECTION` tier that participants/onCall.ts already gates
 *    `assignParticipantToTeamCallable`/`rotateRepresentativeCallable`/
 *    `issueRecoveryCodeCallable` on. `SWITCH_DISPLAY_SLIDE` and
 *    `HIDE_INFORMATION` mirror `PUBLISH_NOTICE`'s tier (both are
 *    classroom-display-facing actions).
 */
export const interventionPermissions: Record<Exclude<LessonInterventionType, 'EXTEND_TIME'>, LessonRunRole[]> = {
  PROXY_CONFIRM: ['PRIMARY', 'ASSISTANT'],
  CHANGE_REPRESENTATIVE: ['PRIMARY', 'ASSISTANT'],
  RECONNECT_PARTICIPANT: ['PRIMARY', 'ASSISTANT'],
  SWITCH_DISPLAY_SLIDE: ['PRIMARY', 'ASSISTANT'],
  CORRECT_STATE: ['PRIMARY'],
  RESTORE_PREVIOUS_PHASE: ['PRIMARY'],
  EMERGENCY_STOP: ['PRIMARY'],
  HIDE_INFORMATION: ['PRIMARY', 'ASSISTANT'],
}

/**
 * `EXTEND_TIME` is the one intervention type whose name and meaning
 * (extending the time limit) are identical to an existing
 * `LessonControlAction` (authorization.ts). Per the task brief's explicit
 * instruction not to reinvent an already-defined permission, this delegates
 * straight to `canControlLesson('EXTEND_TIME', role)` — `EXTEND_TIME` never
 * appears as a key in `interventionPermissions` above, so there is exactly
 * one source of truth for who may extend time, not two tables that could
 * drift apart.
 */
export const canApplyIntervention = (role: LessonRunRole, type: LessonInterventionType): boolean =>
  type === 'EXTEND_TIME' ? canControlLesson(role, 'EXTEND_TIME') : interventionPermissions[type].includes(role)

/**
 * Per-type required `detail` keys, driving both Step 2's table-driven test
 * and `assertInterventionDetail`'s runtime validation. `EMERGENCY_STOP` has
 * no required fields — see `applyTeacherIntervention`'s EMERGENCY_STOP case.
 */
const REQUIRED_DETAIL_KEYS: Record<LessonInterventionType, readonly string[]> = {
  EXTEND_TIME: ['phaseId', 'additionalSeconds'],
  PROXY_CONFIRM: ['phaseId', 'inputId', 'onBehalfOfParticipantId'],
  CHANGE_REPRESENTATIVE: ['teamId', 'newRepresentativeParticipantId'],
  RECONNECT_PARTICIPANT: ['participantId', 'newAuthUid'],
  SWITCH_DISPLAY_SLIDE: ['slideId'],
  CORRECT_STATE: ['targetPath'],
  RESTORE_PREVIOUS_PHASE: ['targetPhaseId'],
  EMERGENCY_STOP: [],
  HIDE_INFORMATION: ['informationId'],
}

const assertInterventionDetail = (type: LessonInterventionType, detail: Record<string, unknown>): void => {
  const missing = REQUIRED_DETAIL_KEYS[type].filter((key) => detail[key] === undefined || detail[key] === null || detail[key] === '')
  if (missing.length > 0) {
    throw new Error(`Missing required detail field(s) for ${type} intervention: ${missing.join(', ')}`)
  }
}

/** Statuses from which a lesson can never move backward — restoring a previous phase would violate the global "REFLECTION は戻さない" constraint. */
const TERMINAL_OR_POST_RUN_STATUSES: LessonRunStatus[] = ['REFLECTION', 'COMPLETED', 'ABORTED', 'ARCHIVED']

/** Intervention types with no delegated existing operation: their only effect is a generic Firestore state write (`after`) alongside the audit event. Phase C/D are expected to give these concrete meaning; Phase B's job (this task) is only to record them auditable and idempotent. */
const GENERIC_STATE_TYPES = new Set<LessonInterventionType>(['EXTEND_TIME', 'SWITCH_DISPLAY_SLIDE', 'CORRECT_STATE', 'HIDE_INFORMATION'])

export interface ApplyTeacherInterventionInput {
  lessonRunId: string
  type: LessonInterventionType
  reason: string
  before: unknown
  after: unknown
  impactScope: InterventionImpactScope
  idempotencyKey: string
  /** Type-specific fields, validated against `REQUIRED_DETAIL_KEYS` before anything else runs. */
  detail: Record<string, unknown>
}

export interface ApplyTeacherInterventionResult {
  type: LessonInterventionType
  eventId: string
  deduplicated: boolean
  /** Whatever the delegated existing function returned (rotateRepresentative/confirmResponse/reconnectParticipant/transitionPhase), or `undefined` for EMERGENCY_STOP/generic-state types. */
  delegatedResult?: unknown
}

/** Delegated existing-function calls, injected so tests can fake them independently of Firestore — production wiring (`applyTeacherInterventionWithAdminSdk` below) binds the real Task 4/5/7/8 functions. */
export interface InterventionDelegates {
  rotateRepresentative: (input: {
    lessonRunId: string; teamId: TeamId; newRepresentativeParticipantId: ParticipantId; reason: string; idempotencyKey: string
  }) => Promise<unknown>
  confirmResponse: (input: {
    lessonRunId: string; participantId?: ParticipantId; teamId?: TeamId; phaseId: string; inputId: string
    actorParticipantId: ParticipantId; actorType: 'TEACHER'; proxyForParticipantId: ParticipantId; idempotencyKey: string
  }) => Promise<unknown>
  reconnectParticipant: (input: {
    lessonRunId: string; participantId: ParticipantId; newAuthUid: string; idempotencyKey: string
  }) => Promise<unknown>
  transitionPhase: (input: {
    lessonRunId: string; targetPhaseId: string; targetStatus?: undefined; reason: string; idempotencyKey: string
  }) => Promise<unknown>
  stopNewOperations: (lessonRunId: string) => Promise<void>
}

export interface ApplyTeacherInterventionDeps {
  firestore: { runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => Promise<T> }
  /** Verified auth uid of the teacher performing the intervention. */
  actorId: string
  now?: () => unknown
  /**
   * Single, transaction-free read of the target run's `orgId`/`status`
   * (same shape as recoveryLifecycle.ts's `CompleteLessonDeps.getCurrentStatus`
   * — see that field's JSDoc for why a plain read is sufficient and does not
   * disturb this function's own transaction's read-before-write ordering).
   * `orgId` is needed for the audit event; `status` is needed to guard
   * RESTORE_PREVIOUS_PHASE against the REFLECTION one-way door.
   */
  loadRunContext: (lessonRunId: string) => Promise<{ orgId: string; status: LessonRunStatus }>
  delegates: InterventionDelegates
}

interface StoredIntervention {
  requestDigest: string
  eventId: string
  sequence: number
}

/**
 * Applies one of the 9 §6.5 mid-lesson teacher interventions. Every
 * intervention produces exactly one `TEACHER_INTERVENTION_APPLIED` audit
 * event — the intervention type itself is recorded as a payload field
 * (`interventionType`), not as a distinct event `type`, so every
 * intervention is queryable/filterable from one event type rather than nine.
 *
 * Two-phase execution, mirroring recoveryLifecycle.ts's `interruptLesson`/
 * `completeLesson` pattern (a delegated call — itself a *separate,
 * self-contained* `db.runTransaction()` — cannot be nested inside this
 * function's own transaction, so it always runs to completion BEFORE this
 * function opens its own transaction for the audit event):
 *
 *  1. (CHANGE_REPRESENTATIVE / PROXY_CONFIRM / RECONNECT_PARTICIPANT /
 *     RESTORE_PREVIOUS_PHASE / EMERGENCY_STOP only) Call the relevant
 *     existing Task 4/5/7/8 function via `deps.delegates` — this is the
 *     actual domain mutation, and it is itself idempotent (each delegate's
 *     own idempotencyKey is derived from this call's `idempotencyKey`), so a
 *     retry of the whole intervention safely re-invokes it and gets back the
 *     same (deduplicated) result rather than double-applying anything.
 *  2. Open this function's own transaction: idempotency check, then
 *     `appendLessonEventInTransaction` (TEACHER_INTERVENTION_APPLIED,
 *     carrying `before`/`after`/`impactScope`/`detail`/`delegatedResult`),
 *     then — for the 4 types with no delegate (EXTEND_TIME,
 *     SWITCH_DISPLAY_SLIDE, CORRECT_STATE, HIDE_INFORMATION) — a generic
 *     Firestore state write recording `after` at
 *     `lessonRuns/{id}/teacherInterventionState/{type}`. READ PHASE
 *     (idempotency doc) completes before any write;
 *     `appendLessonEventInTransaction` (itself get-then-set) runs before
 *     this function's own remaining `tx.set` calls, matching every other
 *     transaction in this codebase.
 *
 * RESTORE_PREVIOUS_PHASE additionally guards against the global "REFLECTION
 * は戻さない授業状態" constraint: `deps.loadRunContext`'s `status` is
 * checked against `TERMINAL_OR_POST_RUN_STATUSES` BEFORE the delegate is
 * ever called, so a call against a REFLECTION/COMPLETED/ABORTED/ARCHIVED run
 * fails fast without invoking `transitionPhase` at all. The delegate itself
 * only ever receives `targetPhaseId` (never `targetStatus`) — restoring a
 * previous phase is implemented as moving `currentPhaseId` back to a caller-
 * supplied prior phase id while `status` stays untouched, exactly the
 * "`transitionPhase` already supports a `targetPhaseId`-only move" mechanism
 * the task brief points at, rather than reversing `status` itself.
 */
export const applyTeacherIntervention = async (
  deps: ApplyTeacherInterventionDeps,
  input: ApplyTeacherInterventionInput,
): Promise<ApplyTeacherInterventionResult> => {
  assertInterventionDetail(input.type, input.detail)
  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  const { orgId, status } = await deps.loadRunContext(input.lessonRunId)

  let delegatedResult: unknown
  switch (input.type) {
    case 'CHANGE_REPRESENTATIVE':
      delegatedResult = await deps.delegates.rotateRepresentative({
        lessonRunId: input.lessonRunId,
        teamId: input.detail.teamId as TeamId,
        newRepresentativeParticipantId: input.detail.newRepresentativeParticipantId as ParticipantId,
        reason: input.reason,
        idempotencyKey: `intervention:${input.idempotencyKey}`,
      })
      break
    case 'PROXY_CONFIRM': {
      const onBehalfOfParticipantId = input.detail.onBehalfOfParticipantId as ParticipantId
      delegatedResult = await deps.delegates.confirmResponse({
        lessonRunId: input.lessonRunId,
        ...(input.impactScope.level === 'TEAM' ? { teamId: input.impactScope.teamId } : { participantId: onBehalfOfParticipantId }),
        phaseId: input.detail.phaseId as string,
        inputId: input.detail.inputId as string,
        actorParticipantId: onBehalfOfParticipantId,
        actorType: 'TEACHER',
        proxyForParticipantId: onBehalfOfParticipantId,
        idempotencyKey: `intervention:${input.idempotencyKey}`,
      })
      break
    }
    case 'RECONNECT_PARTICIPANT':
      delegatedResult = await deps.delegates.reconnectParticipant({
        lessonRunId: input.lessonRunId,
        participantId: input.detail.participantId as ParticipantId,
        newAuthUid: input.detail.newAuthUid as string,
        idempotencyKey: `intervention:${input.idempotencyKey}`,
      })
      break
    case 'RESTORE_PREVIOUS_PHASE':
      if (TERMINAL_OR_POST_RUN_STATUSES.includes(status)) {
        throw new Error(`Cannot restore a previous phase once the lesson has reached REFLECTION or a later status (current: ${status})`)
      }
      delegatedResult = await deps.delegates.transitionPhase({
        lessonRunId: input.lessonRunId,
        targetPhaseId: input.detail.targetPhaseId as string,
        reason: input.reason,
        idempotencyKey: `intervention:${input.idempotencyKey}`,
      })
      break
    case 'EMERGENCY_STOP':
      await deps.delegates.stopNewOperations(input.lessonRunId)
      break
    default:
      // EXTEND_TIME, SWITCH_DISPLAY_SLIDE, CORRECT_STATE, HIDE_INFORMATION:
      // no existing function to delegate to (see GENERIC_STATE_TYPES).
      break
  }

  const idempotencyPath = `lessonRuns/${input.lessonRunId}/teacherInterventionIdempotency/${idempotencyDocumentId(input.lessonRunId, input.idempotencyKey)}`
  const requestDigest = computeRequestDigest({
    type: input.type, reason: input.reason, before: input.before, after: input.after,
    impactScope: input.impactScope, detail: input.detail,
  })

  return deps.firestore.runTransaction(async (tx) => {
    // ---- READ PHASE ----
    const existingIdempotency = await tx.get(idempotencyPath)
    if (existingIdempotency.exists) {
      const prior = existingIdempotency.data() as unknown as StoredIntervention
      if (prior.requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
      return { type: input.type, eventId: prior.eventId, deduplicated: true, delegatedResult }
    }

    // ---- WRITE PHASE ----
    const event = await appendLessonEventInTransaction(tx, {
      lessonRunId: input.lessonRunId,
      orgId,
      type: 'TEACHER_INTERVENTION_APPLIED',
      actorType: 'TEACHER',
      actorId: deps.actorId,
      payload: {
        interventionType: input.type,
        reason: input.reason,
        before: input.before,
        after: input.after,
        impactScope: input.impactScope,
        detail: input.detail,
        delegatedResult: delegatedResult ?? null,
      },
      idempotencyKey: `applied:${input.idempotencyKey}`,
    }, nowValue)

    if (GENERIC_STATE_TYPES.has(input.type)) {
      tx.set(`lessonRuns/${input.lessonRunId}/teacherInterventionState/${input.type}`, {
        type: input.type, after: input.after, updatedAt: nowValue, updatedBy: deps.actorId,
      })
    }

    const stored: StoredIntervention = { requestDigest, eventId: event.eventId, sequence: event.sequence }
    tx.set(idempotencyPath, stored as unknown as Record<string, unknown>)

    return { type: input.type, eventId: event.eventId, deduplicated: false, delegatedResult }
  })
}

/**
 * Production wiring: binds `InterventionDelegates` to the real Task 4/5/7/8
 * functions.
 *
 *  - `rotateRepresentative` -> `rotateRepresentativeWithAdminSdk`
 *    (teams/assignTeam.ts) directly — no new logic.
 *  - `confirmResponse` -> `confirmResponseWithAdminSdk`
 *    (responses/confirmResponse.ts) with `actorType`/`proxyForParticipantId`
 *    forwarded, per that file's PROXY_CONFIRM extension.
 *  - `reconnectParticipant` composes TWO existing recovery.ts functions
 *    server-side — `issueRecoveryCodeWithAdminSdk` then
 *    `recoverParticipantWithAdminSdk` — rather than re-pointing a
 *    participant's `authUid` directly. This reuses the exact same
 *    Firestore-transaction logic a student's own recovery-code redemption
 *    goes through (code hashing, expiry, single-use enforcement, RTDB mirror
 *    ordering); the plaintext code exists only transiently inside this one
 *    function call and is never exposed to the teacher's client.
 *  - `transitionPhase` -> `transitionPhaseWithAdminSdk` (phases/transitionPhase.ts),
 *    called with `targetPhaseId` only (see `applyTeacherIntervention`'s
 *    JSDoc on RESTORE_PREVIOUS_PHASE).
 *  - `stopNewOperations` -> the injected `SubjectLifecycleAdapter`'s own
 *    method (defaults to `noopSubjectLifecycleAdapter`, matching
 *    recoveryLifecycle.ts's `completeLesson` default).
 */
export const applyTeacherInterventionWithAdminSdk = (
  input: ApplyTeacherInterventionInput & { actorId: string; adapter?: SubjectLifecycleAdapter },
): Promise<ApplyTeacherInterventionResult> => {
  const { actorId, adapter, ...rest } = input
  const lifecycleAdapter = adapter ?? noopSubjectLifecycleAdapter

  const loadRunContext = async (lessonRunId: string): Promise<{ orgId: string; status: LessonRunStatus }> => {
    const snap = await getFirestore().doc(`lessonRuns/${lessonRunId}`).get()
    if (!snap.exists) throw new Error('LessonRun not found')
    return { orgId: snap.get('orgId') as string, status: snap.get('status') as LessonRunStatus }
  }

  const delegates: InterventionDelegates = {
    rotateRepresentative: (i) => rotateRepresentativeWithAdminSdk({ ...i, actorId, actorType: 'TEACHER' }),
    confirmResponse: (i) => confirmResponseWithAdminSdk({ ...i, actorId }),
    reconnectParticipant: async (i) => {
      const issued = await issueRecoveryCodeWithAdminSdk({
        lessonRunId: i.lessonRunId, participantId: i.participantId, idempotencyKey: `issue:${i.idempotencyKey}`,
      })
      return recoverParticipantWithAdminSdk({
        lessonRunId: i.lessonRunId, code: issued.code, newAuthUid: i.newAuthUid, idempotencyKey: `redeem:${i.idempotencyKey}`,
      })
    },
    transitionPhase: (i) => transitionPhaseWithAdminSdk({ ...i, actorId, actorType: 'TEACHER' }),
    stopNewOperations: (lessonRunId) => lifecycleAdapter.stopNewOperations(lessonRunId),
  }

  return applyTeacherIntervention({ firestore: adminSdkFirestore(), actorId, loadRunContext, delegates }, rest)
}

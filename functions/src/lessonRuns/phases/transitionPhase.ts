import { getFirestore } from 'firebase-admin/firestore'
import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../../lib/idempotency'
import { appendLessonEventInTransaction, type FirestoreTx } from '../appendLessonEvent'
import { writeCheckpointWithAdminSdk } from '../checkpoint'
import { canTransitionRun, type LessonRunStatus } from './stateMachine'
import { validateLessonForStart, type LessonForStartValidation } from './validation'

export interface TransitionPhaseInput {
  lessonRunId: string
  targetStatus?: LessonRunStatus
  targetPhaseId?: string
  reason: string
  idempotencyKey: string
}

export interface TransitionPhaseResult {
  status: LessonRunStatus
  currentPhaseId: string | null
  deduplicated: boolean
}

export interface WriteCheckpointFn {
  (input: {
    lessonRunId: string
    phaseId: string
    sequence: number
    snapshot: unknown
    createdBy: 'SYSTEM' | 'TEACHER'
    idempotencyKey: string
  }): Promise<{ checkpointId: string; deduplicated: boolean }>
}

export interface TransitionPhaseDeps {
  firestore: { runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => Promise<T> }
  actorId: string
  actorType?: 'TEACHER' | 'SYSTEM'
  /**
   * Pluggable subject-adapter hook (Phase C/D will implement and inject the
   * real version once the market/home-economics engines exist). Called
   * exactly once, only when this transition's `targetStatus` is
   * 'REFLECTION', and — critically — BEFORE the Firestore transition
   * transaction below even starts (see the JSDoc on `transitionPhase` for
   * why). Defaults to a no-op so every transition works today with no
   * active-operations concept to stop yet.
   */
  stopActiveOperations?: (lessonRunId: string) => Promise<void>
  /**
   * Injected so tests can fake it; production wiring
   * (`transitionPhaseWithAdminSdk` below) supplies `writeCheckpointWithAdminSdk`.
   */
  writeCheckpoint: WriteCheckpointFn
  now?: () => unknown
}

/**
 * "Major phase boundary" (§7.7: "自動チェックポイントを主要フェーズ境界で作成
 * する") is judged here purely from whether THIS call's `targetStatus` is
 * RUNNING or REFLECTION — not from the resulting/current status — so that a
 * phase-only move (`targetPhaseId` alone, status unchanged) between two
 * sub-phases while already RUNNING does not spuriously re-checkpoint on
 * every phase change. RUNNING is a boundary because it is the moment the
 * lesson's simulated state starts evolving (§8.2 step 4: "実施版を固定" —
 * the template snapshot and randomSeed become load-bearing from here).
 * REFLECTION is a boundary because it is the moment all further
 * simulation/trading permanently stops (§8.2 step 7) — the last point at
 * which "what the simulation looked like at the end of RUNNING" can still
 * be captured. Other transitions (READY, WAITING, PAUSED, INTERRUPTED,
 * COMPLETED, ABORTED) are not treated as major boundaries by this task,
 * left for a future task to revisit if operational experience shows they
 * need their own checkpoints too.
 */
const isMajorPhaseBoundary = (targetStatus: LessonRunStatus | undefined): boolean =>
  targetStatus === 'RUNNING' || targetStatus === 'REFLECTION'

interface StoredTransition {
  requestDigest: string
  status: LessonRunStatus
  currentPhaseId: string | null
  sequence: number
}

/**
 * Idempotent phase/status transition for a `LessonRun`. `targetStatus` and
 * `targetPhaseId` are each optional but exactly one must be given — never
 * both, never neither. Status changes (§8.2's `DRAFT`/`READY`/.../`ARCHIVED`
 * lifecycle) and phase changes (moving between the lesson's own
 * `LessonPhase` graph nodes while `RUNNING`) are conceptually separate
 * operations in the integrated spec: §8.2 walks the status lifecycle one
 * step at a time (no step describes also picking a phase in the same
 * action), and §7.5/§8.3's phase-graph machinery (`nextPhaseIds`,
 * reachability) is entirely about progression *within* `RUNNING`, not about
 * entering it. No use case for changing both atomically was found in the
 * spec, so this function rejects that combination outright rather than
 * guessing at a merged-event design — see the mutual-exclusion check below.
 * (This also happens to be what caused a real runtime bug: calling
 * `appendLessonEventInTransaction` twice in one Firestore transaction put a
 * `tx.get` after a `tx.set`, violating Firestore's read-before-write
 * transaction rule. Rejecting the combination up front removes the only
 * caller shape that could ever reach that code path.)
 *
 * Each call produces exactly one event: `LESSON_STATUS_CHANGED` when
 * `targetStatus` is given, `PHASE_CHANGED` when `targetPhaseId` is given.
 *
 * Two concerns intentionally sit OUTSIDE the Firestore transaction below:
 *
 *  1. `stopActiveOperations` (subject-adapter hook) runs BEFORE the
 *     transaction starts, per this task's brief. A Firestore Admin SDK
 *     transaction can be retried transparently on contention — anything
 *     with a real external side effect (stopping a market feed, once
 *     Phase C/D implement it) must not be re-invoked by a transaction
 *     retry the way a pure Firestore read/write safely can be. Running it
 *     first also guarantees the market is provably stopped before REFLECTION
 *     is ever observably entered by any reader of `LessonRun.status`.
 *  2. `writeCheckpoint` runs AFTER the transaction commits, matching the
 *     "Firestore commit before any side-effect" ordering established by
 *     Task 3/4 for RTDB writes (`syncMembership` in joinLessonRun.ts).
 *     `writeCheckpointWithAdminSdk` is itself a *separate*, self-contained
 *     `db.runTransaction()` (checkpoint.ts) — it cannot be nested inside
 *     this function's own transaction — so it can only ever run before or
 *     after, and after is correct: a checkpoint must never claim to capture
 *     a state transition that did not actually commit.
 *
 * The checkpoint's `idempotencyKey` is deliberately the transition request's
 * OWN `idempotencyKey` (input.idempotencyKey), not a derived value. This is
 * a known workaround, not an oversight: `writeCheckpoint`'s `checkpointId`
 * is derived from a hash of `idempotencyKey` (checkpoint.ts), not purely
 * from `(restoreGeneration, sequence)`, so two different `idempotencyKey`
 * values for what is logically the "same" checkpoint position would
 * currently produce two separate checkpoint documents instead of
 * deduplicating (a known, intentionally-unfixed design gap from Phase A's
 * Task 9). Reusing the transition's own idempotencyKey means a retried
 * transitionPhase call (same idempotencyKey) always produces the same
 * checkpointId, so retries correctly dedupe — this is an operational-
 * discipline workaround (every caller must consistently reuse the same
 * idempotencyKey across retries of the same logical request), not a fix to
 * writeCheckpoint itself.
 *
 * READ PHASE (idempotency doc, then the LessonRun doc) fully completes
 * before any write, matching the read-before-write discipline established
 * after Task 3's Critical #1 production incident (see joinLessonRun.ts /
 * teams/assignTeam.ts). `appendLessonEventInTransaction` — itself
 * get-then-set — runs before this function's own `tx.set` calls.
 */
export const transitionPhase = async (
  deps: TransitionPhaseDeps,
  input: TransitionPhaseInput,
): Promise<TransitionPhaseResult> => {
  if (!input.targetStatus && !input.targetPhaseId) {
    throw new Error('Nothing to transition: targetStatus or targetPhaseId is required')
  }
  if (input.targetStatus && input.targetPhaseId) {
    throw new Error('targetStatus and targetPhaseId cannot both be specified in a single transition')
  }

  if (input.targetStatus === 'REFLECTION' && deps.stopActiveOperations) {
    await deps.stopActiveOperations(input.lessonRunId)
  }

  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  const idempotencyPath = `lessonRuns/${input.lessonRunId}/transitionPhaseIdempotency/${idempotencyDocumentId(input.lessonRunId, input.idempotencyKey)}`
  const requestDigest = computeRequestDigest({
    targetStatus: input.targetStatus ?? null,
    targetPhaseId: input.targetPhaseId ?? null,
    reason: input.reason,
  })

  const outcome = await deps.firestore.runTransaction(async (tx): Promise<TransitionPhaseResult & { sequence: number }> => {
    // ---- READ PHASE ----
    const existingIdempotency = await tx.get(idempotencyPath)
    if (existingIdempotency.exists) {
      const prior = existingIdempotency.data() as unknown as StoredTransition
      if (prior.requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
      return { status: prior.status, currentPhaseId: prior.currentPhaseId, sequence: prior.sequence, deduplicated: true }
    }

    const runPath = `lessonRuns/${input.lessonRunId}`
    const runSnap = await tx.get(runPath)
    if (!runSnap.exists) throw new Error('LessonRun not found')
    const run = runSnap.data() as Record<string, unknown> & {
      orgId: string
      status: LessonRunStatus
      currentPhaseId: string | null
      subject?: LessonForStartValidation['subject']
      templateSnapshot?: { phases?: LessonForStartValidation['phases']; initialPhaseId?: string }
    }

    if (input.targetStatus && !canTransitionRun(run.status, input.targetStatus)) {
      throw new Error(`Invalid status transition: ${run.status} -> ${input.targetStatus}`)
    }

    // §8.3 "開始前テスト" (validateLessonForStart, validation.ts) is a pure,
    // side-effect-free check over the LessonRun's own templateSnapshot — no
    // extra tx.get is needed, so running it here does not disturb the
    // read-before-write ordering already established above. Only ERROR-
    // severity problems block the transition (矛盾解消G's HOME_ECONOMICS +
    // MARKET conflict is the motivating case); WARNING-severity problems
    // (e.g. DURATION_EXCEEDED) are intentionally not surfaced here — a
    // future task's UI is expected to display them as non-blocking warnings
    // instead (§8.3: "時間超過や偏った結果は警告に留める").
    if (input.targetStatus === 'RUNNING') {
      const lessonForValidation: LessonForStartValidation = {
        subject: run.subject as LessonForStartValidation['subject'],
        phases: run.templateSnapshot?.phases ?? [],
        initialPhaseId: run.templateSnapshot?.initialPhaseId,
      }
      const errors = validateLessonForStart(lessonForValidation).filter((problem) => problem.severity === 'ERROR')
      if (errors.length > 0) {
        throw new Error(`Lesson failed start validation: ${errors.map((problem) => problem.code).join(', ')}`)
      }
    }

    const newStatus = input.targetStatus ?? run.status
    const newPhaseId = input.targetPhaseId ?? run.currentPhaseId

    // ---- WRITE PHASE ----
    let lastSequence = -1
    if (input.targetStatus) {
      const event = await appendLessonEventInTransaction(tx, {
        lessonRunId: input.lessonRunId,
        orgId: run.orgId,
        type: 'LESSON_STATUS_CHANGED',
        actorType: deps.actorType ?? 'TEACHER',
        actorId: deps.actorId,
        payload: { previousStatus: run.status, newStatus, reason: input.reason },
        idempotencyKey: `status:${input.idempotencyKey}`,
      }, nowValue)
      lastSequence = event.sequence
    }
    if (input.targetPhaseId) {
      const event = await appendLessonEventInTransaction(tx, {
        lessonRunId: input.lessonRunId,
        orgId: run.orgId,
        type: 'PHASE_CHANGED',
        actorType: deps.actorType ?? 'TEACHER',
        actorId: deps.actorId,
        payload: { previousPhaseId: run.currentPhaseId, newPhaseId, reason: input.reason },
        idempotencyKey: `phase:${input.idempotencyKey}`,
      }, nowValue)
      lastSequence = event.sequence
    }

    tx.set(runPath, { ...run, status: newStatus, currentPhaseId: newPhaseId })
    const stored: StoredTransition = { requestDigest, status: newStatus, currentPhaseId: newPhaseId, sequence: lastSequence }
    tx.set(idempotencyPath, stored as unknown as Record<string, unknown>)

    return { status: newStatus, currentPhaseId: newPhaseId, sequence: lastSequence, deduplicated: false }
  })

  if (isMajorPhaseBoundary(input.targetStatus)) {
    await deps.writeCheckpoint({
      lessonRunId: input.lessonRunId,
      phaseId: outcome.currentPhaseId ?? 'UNKNOWN',
      sequence: outcome.sequence,
      // Placeholder snapshot: Phase C/D have not yet defined a real
      // `SimulationState` (§7.7) to capture here. Once they do, this should
      // be replaced with the actual simulation/household state at this
      // point rather than this minimal status/phase echo.
      snapshot: { status: outcome.status, currentPhaseId: outcome.currentPhaseId },
      createdBy: deps.actorType ?? 'TEACHER',
      idempotencyKey: input.idempotencyKey,
    })
  }

  return { status: outcome.status, currentPhaseId: outcome.currentPhaseId, deduplicated: outcome.deduplicated }
}

/** Production wiring: Firestore Admin SDK transaction + real checkpoint writer. `stopActiveOperations` is left unset (no-op) — Phase C/D will pass their own implementation once the market/home-economics engines exist. */
export const transitionPhaseWithAdminSdk = (
  input: TransitionPhaseInput & { actorId: string; actorType?: 'TEACHER' | 'SYSTEM' },
): Promise<TransitionPhaseResult> => {
  const db = getFirestore()
  const { actorId, actorType, ...rest } = input
  return transitionPhase({
    firestore: {
      runTransaction: (fn) => db.runTransaction((tx) => fn({
        get: async (path) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
        set: (path, data) => { tx.set(db.doc(path), data) },
      })),
    },
    actorId,
    actorType,
    writeCheckpoint: writeCheckpointWithAdminSdk,
  }, rest)
}

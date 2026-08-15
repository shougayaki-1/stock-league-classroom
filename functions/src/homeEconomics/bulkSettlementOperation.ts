import { getFirestore } from 'firebase-admin/firestore'
import { idempotencyDocumentId, requestDigest } from '../lib/idempotency'
import { householdRepositoryWithAdminSdk, type HouseholdFirestoreDeps } from '../lessonRuns/households/repository'
import type { HouseholdRuntimeControl } from './statusTransition'

export const HOUSEHOLD_BULK_LEASE_MS = 60_000

export type HouseholdBulkSettlementStatus = 'PENDING' | 'RUNNING' | 'FAILED' | 'COMPLETED' | 'CANCELLED'
/** @deprecated Kept as an alias so existing call sites (`teacherDashboard.ts`, Common's COMPLETED/FAILED-only wiring) keep compiling unchanged — use `HouseholdBulkSettlementStatus` in new code. */
export type HouseholdBulkOperationStatus = HouseholdBulkSettlementStatus

export type HouseholdBulkItemStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'

/**
 * One (householdId, teamId, profileId) triple to settle in a bulk run.
 * `householdId` is the RUNTIME household id — for COMMON_CONDITIONS this
 * equals `teamId` (the existing lazy-init convention); for the 3 advanced
 * formats it is the opaque `runtimeHouseholdId()` (Task 1) looked up from
 * the FROZEN `HouseholdAssignmentConfig`'s entries (Task 2/3). Enumeration
 * differs by course format — see `bulkSettlement.ts`'s `listTargets` dep —
 * but every downstream operation-state-machine primitive in this file
 * operates uniformly on this triple regardless of where it came from.
 */
export interface HouseholdBulkTarget {
  householdId: string
  teamId: string
  profileId: string
}

/**
 * Per-household item state within a `HouseholdBulkSettlementOperation`,
 * keyed by RUNTIME `householdId` in `HouseholdBulkSettlementOperation.households`.
 * `teamId`/`profileId` are carried on the item itself (not just derivable
 * from the key) so a teacher-facing view can display "which team / which
 * profile" without a second lookup, and so `MULTI_PERSON_PER_TEAM` (where
 * several items share the same `teamId`) stays unambiguous.
 *
 * `'RUNNING'` is set by `executeBulkItems` (`bulkSettlement.ts`)
 * immediately before it calls `processRoundFn` for this household, and
 * overwritten with `'SUCCEEDED'`/`'FAILED'` once that call resolves —
 * so an item stuck at `'RUNNING'` after a crash is distinguishable, on
 * retry, from one that was never attempted (`'PENDING'`). `retryHouseholdRoundBatch`
 * does not need to treat `'RUNNING'` specially: `executeBulkItems` only ever
 * skips `'SUCCEEDED'` items, so a stale `'RUNNING'` item is simply
 * re-attempted like `'PENDING'`/`'FAILED'` ones.
 */
export interface HouseholdBulkItem {
  teamId: string
  profileId: string
  status: HouseholdBulkItemStatus
  errorCode?: string
  errorMessage?: string
}

export interface HouseholdBulkSettlementOperation {
  operationId: string
  lessonRunId: string
  actorUid: string
  expectedRoundIndex: number
  restoreGeneration: number
  /**
   * The `HouseholdRuntimeControl.assignmentRevision` (Task 3) this operation
   * locked against, for the 3 advanced formats. `null` for COMMON_CONDITIONS,
   * which has no per-team assignment and never acquires the control-document
   * lock. This field doubles as the "does this operation hold/held the
   * control-document SETTLING lock" marker used by `finalizeBulkSettlementOperation`
   * and `cancelBulkSettlementOperation` below to decide whether to also
   * touch `HouseholdRuntimeControl` — see those functions' doc comments.
   */
  assignmentRevision: number | null
  forceUnsubmitted: boolean
  status: HouseholdBulkSettlementStatus
  preSettlementCheckpointId: string | null
  requestDigest: string
  attempt: number
  leaseExpiresAtServerMillis: number | null
  lastHeartbeatAtServerMillis: number | null
  households: Record<string, HouseholdBulkItem>
  createdAtServerMillis: number
  updatedAtServerMillis: number
}

export interface HouseholdBulkSettlementOperationView {
  operationId: string
  expectedRoundIndex: number
  forceUnsubmitted: boolean
  status: HouseholdBulkSettlementStatus
  leaseActive: boolean
  retryable: boolean
  preSettlementCheckpointId: string | null
  households: Record<string, HouseholdBulkItem>
  updatedAtServerMillis: number
}

export const toHouseholdBulkSettlementOperationView = (
  op: HouseholdBulkSettlementOperation,
  nowMillis: number,
): HouseholdBulkSettlementOperationView => {
  const leaseActive = op.status === 'RUNNING' && (op.leaseExpiresAtServerMillis ?? 0) > nowMillis
  // CANCELLED is terminal like COMPLETED — the operation never settled any
  // household and its lock (if any) has already been released by
  // `cancelBulkSettlementOperation`; retrying it would have nothing to do.
  const retryable = op.status !== 'COMPLETED' && op.status !== 'CANCELLED' && !leaseActive
  return {
    operationId: op.operationId,
    expectedRoundIndex: op.expectedRoundIndex,
    forceUnsubmitted: op.forceUnsubmitted,
    status: op.status,
    leaseActive,
    retryable,
    preSettlementCheckpointId: op.preSettlementCheckpointId,
    households: op.households,
    updatedAtServerMillis: op.updatedAtServerMillis,
  }
}

const sortedTargets = (targets: HouseholdBulkTarget[]): HouseholdBulkTarget[] =>
  [...targets].sort((a, b) => a.householdId.localeCompare(b.householdId))

/**
 * Deterministic (householdId, teamId, profileId) triples for inclusion in
 * `requestDigest` — sorted by `householdId` regardless of the caller's
 * input order, so idempotency-key replays with the SAME logical target set
 * but different array ordering are still recognized as the same request,
 * while a genuinely DIFFERENT target set (e.g. the team roster changed
 * between the first attempt and a retry) is rejected as a payload mismatch.
 */
const sortedTargetTriples = (targets: HouseholdBulkTarget[]): Array<[string, string, string]> =>
  sortedTargets(targets).map((target) => [target.householdId, target.teamId, target.profileId])

const buildPendingHouseholds = (targets: HouseholdBulkTarget[]): Record<string, HouseholdBulkItem> => {
  const households: Record<string, HouseholdBulkItem> = {}
  for (const target of sortedTargets(targets)) {
    households[target.householdId] = { teamId: target.teamId, profileId: target.profileId, status: 'PENDING' }
  }
  return households
}

export interface CreateOrReplayBulkSettlementOperationInput {
  firestore: HouseholdFirestoreDeps['firestore']
  lessonRunId: string
  idempotencyKey: string
  actorUid: string
  expectedRoundIndex: number
  restoreGeneration: number
  /** `null` for COMMON_CONDITIONS. Advanced formats must use `createOrReplayBulkSettlementOperationWithControlLock` instead, which requires this as a real `number`. */
  assignmentRevision: number | null
  forceUnsubmitted: boolean
  targets: HouseholdBulkTarget[]
  nowMillis: number
}

/**
 * COMMON_CONDITIONS path: no `HouseholdRuntimeControl` document exists for
 * this course format, so there is nothing to lock — this stays a single,
 * unlocked create/replay transaction exactly like before Task 6.
 */
export const createOrReplayBulkSettlementOperation = (
  input: CreateOrReplayBulkSettlementOperationInput,
): Promise<HouseholdBulkSettlementOperation> =>
  input.firestore.runTransaction(async (tx) => {
    const operationId = idempotencyDocumentId(input.lessonRunId, input.idempotencyKey)
    const opPath = `householdBulkSettlementOperations/${operationId}`
    const digest = requestDigest({
      lessonRunId: input.lessonRunId,
      expectedRoundIndex: input.expectedRoundIndex,
      forceUnsubmitted: input.forceUnsubmitted,
      restoreGeneration: input.restoreGeneration,
      actorUid: input.actorUid,
      targets: sortedTargetTriples(input.targets),
    })

    // ---- ALL READS FIRST ----
    const existing = await tx.get(opPath)
    if (existing.exists) {
      const prior = existing.data() as unknown as HouseholdBulkSettlementOperation
      if (prior.requestDigest !== digest) {
        throw new Error('Idempotency key payload mismatch')
      }
      return prior
    }

    // ---- ALL WRITES AFTER ----
    const op: HouseholdBulkSettlementOperation = {
      operationId,
      lessonRunId: input.lessonRunId,
      actorUid: input.actorUid,
      expectedRoundIndex: input.expectedRoundIndex,
      restoreGeneration: input.restoreGeneration,
      assignmentRevision: input.assignmentRevision,
      forceUnsubmitted: input.forceUnsubmitted,
      status: 'PENDING',
      preSettlementCheckpointId: null,
      requestDigest: digest,
      attempt: 0,
      leaseExpiresAtServerMillis: null,
      lastHeartbeatAtServerMillis: null,
      households: buildPendingHouseholds(input.targets),
      createdAtServerMillis: input.nowMillis,
      updatedAtServerMillis: input.nowMillis,
    }

    tx.set(opPath, op as unknown as Record<string, unknown>)
    return op
  })

export interface CreateOrReplayBulkSettlementOperationWithControlLockInput {
  firestore: HouseholdFirestoreDeps['firestore']
  lessonRunId: string
  idempotencyKey: string
  actorUid: string
  expectedRoundIndex: number
  restoreGeneration: number
  assignmentRevision: number
  forceUnsubmitted: boolean
  targets: HouseholdBulkTarget[]
  nowMillis: number
}

/**
 * Advanced-format (ROLE_VARIANT/STAGE_SPLIT/MULTI_PERSON_PER_TEAM)
 * counterpart to `createOrReplayBulkSettlementOperation` — the "other side"
 * of Task 5's `saveAdvancedHouseholdDecisionWithAdminSdk` guard
 * (`lessonRuns/households/repository.ts`). Both read/guard the SAME
 * `lessonRuns/{lessonRunId}/householdRuntime/control` document (Task 3), so
 * `roundStatus: 'OPEN' -> 'SETTLING'` genuinely is the mutual-exclusion
 * point between "a student can still submit a decision" and "the teacher is
 * bulk-settling this round."
 *
 * Mirrors Task 5's exact three-way check before allowing the write: the
 * control document must be `roundStatus === 'OPEN'`, its `assignmentRevision`
 * must match what the caller observed, and its `synchronizedRoundIndex` must
 * match the round the caller expects to settle. All of that, PLUS creating
 * the operation document and flipping the control document to
 * `SETTLING`/`activeOperationId`, happens in ONE transaction — so a lease
 * acquire failure can never leave a half-created operation, and an operation
 * can never exist without the control document reflecting that it (or a
 * subsequent finalize/cancel) is responsible for the lock.
 *
 * Idempotency replay (same `idempotencyKey` reused): returns the prior
 * operation as-is WITHOUT re-touching the control document — the original
 * create call already performed (or the operation has since been
 * finalized/cancelled and already released) whatever lock state applies;
 * replaying a create must never re-lock a round that has already moved on.
 */
export const createOrReplayBulkSettlementOperationWithControlLock = (
  input: CreateOrReplayBulkSettlementOperationWithControlLockInput,
): Promise<HouseholdBulkSettlementOperation> =>
  input.firestore.runTransaction(async (tx) => {
    const operationId = idempotencyDocumentId(input.lessonRunId, input.idempotencyKey)
    const opPath = `householdBulkSettlementOperations/${operationId}`
    const controlPath = `lessonRuns/${input.lessonRunId}/householdRuntime/control`
    const digest = requestDigest({
      lessonRunId: input.lessonRunId,
      expectedRoundIndex: input.expectedRoundIndex,
      forceUnsubmitted: input.forceUnsubmitted,
      restoreGeneration: input.restoreGeneration,
      actorUid: input.actorUid,
      assignmentRevision: input.assignmentRevision,
      targets: sortedTargetTriples(input.targets),
    })

    // ---- ALL READS FIRST ----
    const existingOp = await tx.get(opPath)
    if (existingOp.exists) {
      const prior = existingOp.data() as unknown as HouseholdBulkSettlementOperation
      if (prior.requestDigest !== digest) {
        throw new Error('Idempotency key payload mismatch')
      }
      return prior
    }

    const controlSnap = await tx.get(controlPath)
    if (!controlSnap.exists) throw new Error('HouseholdRuntimeControl not found')
    const control = controlSnap.data() as unknown as HouseholdRuntimeControl

    if (control.roundStatus !== 'OPEN') {
      throw new Error('HouseholdRuntimeControl round is not OPEN (a bulk settlement is already in progress)')
    }
    if (control.assignmentRevision !== input.assignmentRevision) {
      throw new Error('HouseholdRuntimeControl assignmentRevision does not match the expected assignment revision')
    }
    if (control.synchronizedRoundIndex !== input.expectedRoundIndex) {
      throw new Error('HouseholdRuntimeControl synchronizedRoundIndex does not match the expected round index')
    }

    // ---- ALL WRITES AFTER ----
    const op: HouseholdBulkSettlementOperation = {
      operationId,
      lessonRunId: input.lessonRunId,
      actorUid: input.actorUid,
      expectedRoundIndex: input.expectedRoundIndex,
      restoreGeneration: input.restoreGeneration,
      assignmentRevision: input.assignmentRevision,
      forceUnsubmitted: input.forceUnsubmitted,
      status: 'PENDING',
      preSettlementCheckpointId: null,
      requestDigest: digest,
      attempt: 0,
      leaseExpiresAtServerMillis: null,
      lastHeartbeatAtServerMillis: null,
      households: buildPendingHouseholds(input.targets),
      createdAtServerMillis: input.nowMillis,
      updatedAtServerMillis: input.nowMillis,
    }

    tx.set(opPath, op as unknown as Record<string, unknown>)
    tx.set(controlPath, {
      ...control,
      roundStatus: 'SETTLING',
      activeOperationId: operationId,
      updatedAtServerMillis: input.nowMillis,
    } as unknown as Record<string, unknown>)
    return op
  })

export interface AcquireBulkSettlementLeaseInput {
  firestore: HouseholdFirestoreDeps['firestore']
  operationId: string
  actorUid: string
  nowMillis: number
}

export const acquireBulkSettlementLease = (
  input: AcquireBulkSettlementLeaseInput,
): Promise<HouseholdBulkSettlementOperation> =>
  input.firestore.runTransaction(async (tx) => {
    const opPath = `householdBulkSettlementOperations/${input.operationId}`
    // ---- ALL READS FIRST ----
    const existing = await tx.get(opPath)
    if (!existing.exists) throw new Error('Bulk settlement operation not found')
    const op = existing.data() as unknown as HouseholdBulkSettlementOperation

    if (op.status === 'COMPLETED') {
      throw new Error('Operation is already completed')
    }
    if (op.status === 'CANCELLED') {
      throw new Error('Operation is already cancelled')
    }

    const isLeaseActive = op.status === 'RUNNING' && (op.leaseExpiresAtServerMillis ?? 0) > input.nowMillis
    if (isLeaseActive && op.actorUid !== input.actorUid) {
      throw new Error('Active lease held by another process')
    }

    // ---- ALL WRITES AFTER ----
    const updated: HouseholdBulkSettlementOperation = {
      ...op,
      status: 'RUNNING',
      attempt: op.attempt + 1,
      leaseExpiresAtServerMillis: input.nowMillis + HOUSEHOLD_BULK_LEASE_MS,
      lastHeartbeatAtServerMillis: input.nowMillis,
      updatedAtServerMillis: input.nowMillis,
    }
    tx.set(opPath, updated as unknown as Record<string, unknown>)
    return updated
  })

export interface HeartbeatBulkSettlementLeaseInput {
  firestore: HouseholdFirestoreDeps['firestore']
  operationId: string
  nowMillis: number
}

export const heartbeatBulkSettlementLease = (
  input: HeartbeatBulkSettlementLeaseInput,
): Promise<HouseholdBulkSettlementOperation> =>
  input.firestore.runTransaction(async (tx) => {
    const opPath = `householdBulkSettlementOperations/${input.operationId}`
    // ---- ALL READS FIRST ----
    const existing = await tx.get(opPath)
    if (!existing.exists) throw new Error('Bulk settlement operation not found')
    const op = existing.data() as unknown as HouseholdBulkSettlementOperation

    // ---- ALL WRITES AFTER ----
    const updated: HouseholdBulkSettlementOperation = {
      ...op,
      lastHeartbeatAtServerMillis: input.nowMillis,
      leaseExpiresAtServerMillis: input.nowMillis + HOUSEHOLD_BULK_LEASE_MS,
      updatedAtServerMillis: input.nowMillis,
    }
    tx.set(opPath, updated as unknown as Record<string, unknown>)
    return updated
  })

export interface UpdateHouseholdBulkItemStatusInput {
  firestore: HouseholdFirestoreDeps['firestore']
  operationId: string
  householdId: string
  status: HouseholdBulkItemStatus
  errorCode?: string
  errorMessage?: string
  nowMillis: number
}

export const updateHouseholdBulkItemStatus = (
  input: UpdateHouseholdBulkItemStatusInput,
): Promise<HouseholdBulkSettlementOperation> =>
  input.firestore.runTransaction(async (tx) => {
    const opPath = `householdBulkSettlementOperations/${input.operationId}`
    // ---- ALL READS FIRST ----
    const existing = await tx.get(opPath)
    if (!existing.exists) throw new Error('Bulk settlement operation not found')
    const op = existing.data() as unknown as HouseholdBulkSettlementOperation

    const priorItem = op.households[input.householdId]
    if (!priorItem) throw new Error(`No such household item in operation: ${input.householdId}`)

    // ---- ALL WRITES AFTER ----
    const itemData: HouseholdBulkItem = {
      teamId: priorItem.teamId,
      profileId: priorItem.profileId,
      status: input.status,
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      ...(input.errorMessage ? { errorMessage: input.errorMessage } : {})
    }
    const updatedHouseholds = {
      ...op.households,
      [input.householdId]: itemData,
    }
    const updated: HouseholdBulkSettlementOperation = {
      ...op,
      households: updatedHouseholds,
      updatedAtServerMillis: input.nowMillis,
    }
    tx.set(opPath, updated as unknown as Record<string, unknown>)
    return updated
  })

export interface SetPreSettlementCheckpointIdInput {
  firestore: HouseholdFirestoreDeps['firestore']
  operationId: string
  checkpointId: string
  nowMillis: number
}

export const setPreSettlementCheckpointId = (
  input: SetPreSettlementCheckpointIdInput,
): Promise<HouseholdBulkSettlementOperation> =>
  input.firestore.runTransaction(async (tx) => {
    const opPath = `householdBulkSettlementOperations/${input.operationId}`
    // ---- ALL READS FIRST ----
    const existing = await tx.get(opPath)
    if (!existing.exists) throw new Error('Bulk settlement operation not found')
    const op = existing.data() as unknown as HouseholdBulkSettlementOperation

    // ---- ALL WRITES AFTER ----
    const updated: HouseholdBulkSettlementOperation = {
      ...op,
      preSettlementCheckpointId: input.checkpointId,
      updatedAtServerMillis: input.nowMillis,
    }
    tx.set(opPath, updated as unknown as Record<string, unknown>)
    return updated
  })

export interface FinalizeBulkSettlementOperationInput {
  firestore: HouseholdFirestoreDeps['firestore']
  operationId: string
  status: 'COMPLETED' | 'FAILED'
  nowMillis: number
}

/**
 * Terminal transition for an operation that actually ran its items to
 * completion (whether every item succeeded or not) — as opposed to
 * `cancelBulkSettlementOperation` below, which is for an operation that
 * never got to run any item at all.
 *
 * For the 3 advanced formats (`op.assignmentRevision !== null` — see that
 * field's doc comment), this is ALSO the atomic control-document unlock
 * point, but ONLY on full success:
 *   - `status === 'COMPLETED'` (every item `SUCCEEDED`): the SAME
 *     transaction flips the control document back to `roundStatus: 'OPEN'`,
 *     clears `activeOperationId`, and advances `synchronizedRoundIndex` by
 *     1 — this is the exact moment students become able to submit decisions
 *     for the NEXT round (Task 5's guard reads `synchronizedRoundIndex`).
 *   - `status === 'FAILED'` (partial failure): the control document is left
 *     completely untouched, still `SETTLING` at the SAME round — so a
 *     `retryHouseholdRoundBatch` call can pick up where it left off
 *     (`executeBulkItems` already skips `SUCCEEDED` items) without ever
 *     allowing a decision submission mid-retry, and without double-advancing
 *     the round on a later successful retry.
 * COMMON_CONDITIONS (`op.assignmentRevision === null`) never touches the
 * control document in either branch — it never acquired the lock in the
 * first place.
 *
 * The `control.activeOperationId === op.operationId` guard defends against
 * finalizing a stale/duplicate operation object from ever clobbering a
 * DIFFERENT operation's active lock (should not normally happen given the
 * single-unresolved-operation-per-lessonRun invariant `bulkSettlement.ts`
 * already enforces, but cheap to check here since the control doc is
 * already being read).
 */
export const finalizeBulkSettlementOperation = (
  input: FinalizeBulkSettlementOperationInput,
): Promise<HouseholdBulkSettlementOperation> =>
  input.firestore.runTransaction(async (tx) => {
    const opPath = `householdBulkSettlementOperations/${input.operationId}`
    // ---- ALL READS FIRST ----
    const existing = await tx.get(opPath)
    if (!existing.exists) throw new Error('Bulk settlement operation not found')
    const op = existing.data() as unknown as HouseholdBulkSettlementOperation

    const isControlLocked = op.assignmentRevision !== null
    const controlPath = `lessonRuns/${op.lessonRunId}/householdRuntime/control`
    const controlSnap = isControlLocked ? await tx.get(controlPath) : null

    // ---- ALL WRITES AFTER ----
    const updated: HouseholdBulkSettlementOperation = {
      ...op,
      status: input.status,
      leaseExpiresAtServerMillis: null,
      updatedAtServerMillis: input.nowMillis,
    }
    tx.set(opPath, updated as unknown as Record<string, unknown>)

    if (isControlLocked && input.status === 'COMPLETED' && controlSnap?.exists) {
      const control = controlSnap.data() as unknown as HouseholdRuntimeControl
      if (control.activeOperationId === op.operationId) {
        tx.set(controlPath, {
          ...control,
          roundStatus: 'OPEN',
          activeOperationId: null,
          synchronizedRoundIndex: control.synchronizedRoundIndex + 1,
          updatedAtServerMillis: input.nowMillis,
        } as unknown as Record<string, unknown>)
      }
    }

    return updated
  })

export interface CancelBulkSettlementOperationInput {
  firestore: HouseholdFirestoreDeps['firestore']
  operationId: string
  nowMillis: number
  /**
   * When set, identifies the actor performing THIS cancel call. If the
   * transaction's own fresh read finds the operation `RUNNING` with an
   * active lease held by exactly this actor, the cancel is still allowed —
   * this is the "preflight-cancel" case (`bulkSettlement.ts`'s
   * `preflightFail`), where the SAME call chain just acquired the lease for
   * itself moments earlier and is now aborting its own attempt before any
   * item ran. Any other active lease (held by a different actor, or when
   * this is omitted — e.g. the restore-time cleanup path, which is not
   * acting on behalf of a specific actor) is a hard block: see
   * `BulkSettlementOperationNotCancellableError`.
   */
  expectedActorUid?: string
}

/**
 * Thrown by `cancelBulkSettlementOperation` when its OWN transactional read
 * finds the operation already terminal (`COMPLETED`/`CANCELLED`) or under an
 * active lease not owned by `input.expectedActorUid` — i.e. it legitimately
 * transitioned between an earlier, separate read (e.g. the restore path's
 * outer `cancelInactiveUnresolvedBulkSettlementOperation` check) and this
 * transaction actually running. Callers that only have a possibly-stale
 * candidate (not a lease they hold themselves) should catch this and treat
 * it as a safe no-op, exactly like their outer pre-check already does for
 * the non-racy case — see `cancelInactiveUnresolvedBulkSettlementOperation`.
 */
export class BulkSettlementOperationNotCancellableError extends Error {
  constructor(message = 'Operation already resolved or has an active lease') {
    super(message)
    this.name = 'BulkSettlementOperationNotCancellableError'
  }
}

/**
 * Terminal transition for an operation that must stop BEFORE it processes
 * any household item — the preflight-cancel path (`bulkSettlement.ts`):
 * a round-index mismatch, or a missing required decision without
 * `forceUnsubmitted`. Sets `status: 'CANCELLED'` and, for the 3 advanced
 * formats (`op.assignmentRevision !== null`), atomically releases the
 * control-document lock this operation acquired (`roundStatus: 'OPEN'`,
 * `activeOperationId: null`) in the SAME transaction — deliberately NOT
 * advancing `synchronizedRoundIndex`, since no item was ever actually
 * settled. COMMON_CONDITIONS never touches the control document (it never
 * held a lock). Used uniformly for BOTH course-format families — Common's
 * preflight failure and an advanced format's preflight-cancel are the same
 * shape ("this operation never started settling anything, so there is
 * nothing left to retry, and any lock must be released immediately") and
 * share this one function rather than diverging into a Common-only
 * `'FAILED'` special case.
 *
 * Re-validates terminal/active-lease state against its OWN transactional
 * read (not a value the caller read earlier) before ever writing
 * `CANCELLED` — see `BulkSettlementOperationNotCancellableError`. This
 * closes a TOCTOU where an outer, non-transactional check (e.g. the
 * restore-time cleanup's `cancelInactiveUnresolvedBulkSettlementOperation`)
 * saw a safe-to-cancel snapshot, but by the time this transaction actually
 * ran, the SAME operation had legitimately moved to `RUNNING`-with-active-
 * lease or `COMPLETED` — which must never be silently overwritten.
 */
export const cancelBulkSettlementOperation = (
  input: CancelBulkSettlementOperationInput,
): Promise<HouseholdBulkSettlementOperation> =>
  input.firestore.runTransaction(async (tx) => {
    const opPath = `householdBulkSettlementOperations/${input.operationId}`
    // ---- ALL READS FIRST ----
    const existing = await tx.get(opPath)
    if (!existing.exists) throw new Error('Bulk settlement operation not found')
    const op = existing.data() as unknown as HouseholdBulkSettlementOperation

    const isTerminal = op.status === 'COMPLETED' || op.status === 'CANCELLED'
    const hasActiveLease = op.status === 'RUNNING' && (op.leaseExpiresAtServerMillis ?? 0) > input.nowMillis
    const isOwnActiveLease = hasActiveLease
      && input.expectedActorUid !== undefined
      && op.actorUid === input.expectedActorUid
    if (isTerminal || (hasActiveLease && !isOwnActiveLease)) {
      throw new BulkSettlementOperationNotCancellableError()
    }

    const isControlLocked = op.assignmentRevision !== null
    const controlPath = `lessonRuns/${op.lessonRunId}/householdRuntime/control`
    const controlSnap = isControlLocked ? await tx.get(controlPath) : null

    // ---- ALL WRITES AFTER ----
    const updated: HouseholdBulkSettlementOperation = {
      ...op,
      status: 'CANCELLED',
      leaseExpiresAtServerMillis: null,
      updatedAtServerMillis: input.nowMillis,
    }
    tx.set(opPath, updated as unknown as Record<string, unknown>)

    if (isControlLocked && controlSnap?.exists) {
      const control = controlSnap.data() as unknown as HouseholdRuntimeControl
      if (control.activeOperationId === op.operationId) {
        tx.set(controlPath, {
          ...control,
          roundStatus: 'OPEN',
          activeOperationId: null,
          updatedAtServerMillis: input.nowMillis,
        } as unknown as Record<string, unknown>)
      }
    }

    return updated
  })

export const getBulkSettlementOperationWithAdminSdk = async (
  operationId: string,
): Promise<HouseholdBulkSettlementOperation | null> => {
  const snap = await getFirestore().doc(`householdBulkSettlementOperations/${operationId}`).get()
  if (!snap.exists) return null
  return snap.data() as unknown as HouseholdBulkSettlementOperation
}

export const findActiveBulkSettlementLeaseWithAdminSdk = async (
  lessonRunId: string,
  nowMillis: number,
): Promise<HouseholdBulkSettlementOperation | null> => {
  const snap = await getFirestore()
    .collection('householdBulkSettlementOperations')
    .where('lessonRunId', '==', lessonRunId)
    .where('status', '==', 'RUNNING')
    .get()

  for (const doc of snap.docs) {
    const op = doc.data() as unknown as HouseholdBulkSettlementOperation
    if ((op.leaseExpiresAtServerMillis ?? 0) > nowMillis) {
      return op
    }
  }
  return null
}

export const findUnresolvedBulkSettlementOperationWithAdminSdk = async (
  lessonRunId: string,
): Promise<HouseholdBulkSettlementOperation | null> => {
  const snap = await getFirestore()
    .collection('householdBulkSettlementOperations')
    .where('lessonRunId', '==', lessonRunId)
    .get()

  const unresolved = snap.docs
    .map((doc) => doc.data() as unknown as HouseholdBulkSettlementOperation)
    .filter((op) => op.status !== 'COMPLETED' && op.status !== 'CANCELLED')
    .sort((a, b) => b.updatedAtServerMillis - a.updatedAtServerMillis)

  return unresolved[0] ?? null
}

export interface CancelInactiveUnresolvedBulkSettlementOperationInput {
  firestore: HouseholdFirestoreDeps['firestore']
  /**
   * The unresolved (not `COMPLETED`, not `CANCELLED`) operation to consider
   * cancelling, or `null` if none exists — the caller is expected to have
   * already looked this up (e.g. via `findUnresolvedBulkSettlementOperationWithAdminSdk`),
   * so this core function stays transaction-testable with a fake `firestore`
   * the way every other primitive in this file is, instead of embedding a
   * live Firestore query (which the fakes used across this repo's tests
   * cannot simulate).
   */
  candidate: HouseholdBulkSettlementOperation | null
  nowMillis: number
}

/**
 * Restore-time cleanup shared by v2 (`householdRestore.ts`'s
 * `restoreHouseholdCheckpointV2`) and v3 (`restoreHouseholdCheckpointV3`):
 * a household checkpoint restore rewinds the round state, so any
 * PENDING/RUNNING/FAILED bulk-settlement operation left over from BEFORE the
 * restore is now stale — if left alone it would block the next bulk
 * settlement attempt (`findUnresolvedBulkSettlementOperationWithAdminSdk`'s
 * single-unresolved-operation-per-lessonRun invariant). This atomically
 * transitions such an operation to `CANCELLED` via `cancelBulkSettlementOperation`
 * (which itself, for the 3 advanced formats, also releases the
 * `HouseholdRuntimeControl` lock in the same transaction — see that
 * function's doc comment) — UNLESS the candidate is:
 *   - currently under an ACTIVE lease (`RUNNING` with a still-live
 *     `leaseExpiresAtServerMillis`) — both restore flows already hard-reject
 *     outright when an active lease exists (`checkActiveBulkLease`), so
 *     observing one active here would only happen from a race, and this
 *     function must never force-cancel someone else's in-flight work; or
 *   - already terminal (`COMPLETED`/`CANCELLED`) — the caller is expected to
 *     capture `candidate` ONCE (by a specific `operationId`, see
 *     `cancelInactiveUnresolvedBulkSettlementOperationByIdWithAdminSdk`
 *     below) and re-fetch its current state immediately before calling this
 *     function, so this can legitimately observe an operation that someone
 *     else already finished/cancelled in the gap — that must be a safe no-op,
 *     not a re-open of a terminal operation.
 *
 * This function's own two checks above are a fast pre-filter on `candidate`
 * (a snapshot that may itself already be stale by the time it's inspected
 * here). The actual, authoritative guard is INSIDE `cancelBulkSettlementOperation`'s
 * own transaction, which re-reads the operation fresh and throws
 * `BulkSettlementOperationNotCancellableError` if ITS read finds a terminal
 * status or an active lease — closing the remaining TOCTOU window between
 * this pre-filter and that transaction actually running (e.g. the operation
 * legitimately acquired a lease, or completed, in that gap). That error is
 * caught here and treated exactly the same as the pre-filter's own null
 * cases: a safe no-op, never a hard failure of the caller's restore flow.
 */
export const cancelInactiveUnresolvedBulkSettlementOperation = async (
  input: CancelInactiveUnresolvedBulkSettlementOperationInput,
): Promise<HouseholdBulkSettlementOperation | null> => {
  if (!input.candidate) return null

  if (input.candidate.status === 'COMPLETED' || input.candidate.status === 'CANCELLED') return null

  const leaseActive = input.candidate.status === 'RUNNING'
    && (input.candidate.leaseExpiresAtServerMillis ?? 0) > input.nowMillis
  if (leaseActive) return null

  try {
    return await cancelBulkSettlementOperation({
      firestore: input.firestore,
      operationId: input.candidate.operationId,
      nowMillis: input.nowMillis,
    })
  } catch (err) {
    if (err instanceof BulkSettlementOperationNotCancellableError) return null
    throw err
  }
}

/**
 * Looks up the `operationId` of the currently-unresolved bulk-settlement
 * operation for this lessonRun (if any), via the live-Firestore query
 * (`findUnresolvedBulkSettlementOperationWithAdminSdk`). Intended to be
 * called ONCE per genuinely new restore attempt to CAPTURE a specific
 * candidate id — see `HouseholdRestoreDeps.findUnresolvedBulkOperationId`'s
 * doc comment in `householdRestore.ts` for why the restore flows must not
 * re-run this query a second time right before cancelling (that re-query is
 * exactly the race this split guards against).
 */
export const findUnresolvedBulkSettlementOperationIdWithAdminSdk = async (
  lessonRunId: string,
): Promise<string | null> => {
  const candidate = await findUnresolvedBulkSettlementOperationWithAdminSdk(lessonRunId)
  return candidate?.operationId ?? null
}

/**
 * Production wiring for both restore paths' `HouseholdRestoreDeps.cancelInactiveUnresolvedBulkOperationById`
 * dependency: fetches the SPECIFIC operation named by `operationId` via a
 * targeted document read (`getBulkSettlementOperationWithAdminSdk`) — never
 * a fresh "whatever is unresolved right now" query — then delegates the
 * actual atomic decision/transition to `cancelInactiveUnresolvedBulkSettlementOperation`,
 * which itself no-ops if that specific operation is no longer a legitimate
 * cancellation target (already terminal, or under an active lease) by the
 * time this runs.
 */
export const cancelInactiveUnresolvedBulkSettlementOperationByIdWithAdminSdk = async (
  operationId: string,
  nowMillis: number,
): Promise<void> => {
  const candidate = await getBulkSettlementOperationWithAdminSdk(operationId)
  await cancelInactiveUnresolvedBulkSettlementOperation({
    firestore: householdRepositoryWithAdminSdk(),
    candidate,
    nowMillis,
  })
}

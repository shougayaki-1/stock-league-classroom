import { getFirestore } from 'firebase-admin/firestore'
import { getDatabase } from 'firebase-admin/database'
import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'
import { idempotencyDocumentId, requestDigest } from '../lib/idempotency'
import {
  householdRepositoryWithAdminSdk,
  type HouseholdFirestoreDeps,
  type HouseholdState,
} from '../lessonRuns/households/repository'
import {
  cancelInactiveUnresolvedBulkSettlementOperationByIdWithAdminSdk,
  findActiveBulkSettlementLeaseWithAdminSdk,
  findUnresolvedBulkSettlementOperationIdWithAdminSdk,
} from './bulkSettlementOperation'
import {
  isHouseholdCheckpointSnapshotV2,
  isHouseholdCheckpointSnapshotV3,
  readTeamViewWithAdminSdk,
  writeHouseholdCheckpointV2,
  writeHouseholdCheckpointV3,
  type HouseholdCheckpointSnapshotV2,
  type HouseholdCheckpointSnapshotV3,
} from './householdCheckpoint'
import { appendLessonEventInTransaction, type FirestoreTx } from '../lessonRuns/appendLessonEvent'
import { ensureCommonConditionsHouseholdStateWithAdminSdk } from './commonConditionsHousehold'
import { resolveVisibleConcepts } from './goalPackage'
import { advancedTeamControlStateFields } from './realtimeProjection'
import type { HouseholdAssignmentEntry } from './householdAssignment'
import type { HouseholdAssignmentConfig } from './householdAssignmentRepository'
import type { HouseholdRuntimeControl } from './statusTransition'

export interface HouseholdRestoreIdempotencyRecord {
  checkpointId: string
  requestDigest: string
  newRestoreGeneration: number
  eventId: string
  preRestoreCheckpointId: string
  projectionStatus: 'PENDING' | 'SYNCED'
}

export interface HouseholdRestoreDeps {
  firestore: HouseholdFirestoreDeps['firestore']
  checkActiveBulkLease: (lessonRunId: string, nowMillis: number) => Promise<boolean>
  listTeamIds: (lessonRunId: string) => Promise<string[]>
  savePreRestoreCheckpoint: (input: {
    lessonRunId: string
    actorUid: string
    idempotencyKey: string
    nowMillis: number
  }) => Promise<{ checkpointId: string; created: boolean }>
  syncRtdbProjections: (updates: Record<string, unknown>) => Promise<void>
  /**
   * Restore-time cleanup, new in this task: any unresolved (not `COMPLETED`
   * or `CANCELLED`) bulk-settlement operation for this lessonRun that is NOT
   * currently under an active lease must be atomically transitioned to
   * `CANCELLED` as part of a restore, so a stale/abandoned operation from
   * before the restore doesn't linger and block the next bulk settlement
   * attempt after the round state has been rewound.
   *
   * Fixed after an earlier version of this dependency raced with genuinely
   * NEW/concurrent bulk operations: the earlier `cancelInactiveUnresolvedBulkOperation(lessonRunId, nowMillis)`
   * shape re-queried "whatever is unresolved right now" INSIDE its own
   * implementation, unconditionally on every call (including pure RTDB-sync
   * retries of an already-committed restore). A brand-new bulk operation
   * created by another teacher device in the gap between this restore's
   * `checkActiveBulkLease` check and the cancel step would be `PENDING` with
   * no lease yet — invisible to `checkActiveBulkLease` — and could get
   * force-cancelled by that fresh re-query, destroying unrelated in-flight
   * work (and, for advanced formats, force-releasing its `HouseholdRuntimeControl`
   * lock).
   *
   * Now split into two steps, both below, so the restore flows can fence the
   * cancel to a SINGLE specific operation captured ONCE, only on a genuinely
   * new attempt:
   *   1. `findUnresolvedBulkOperationId` — look up the current candidate's
   *      id ONCE, only when this call is NOT a retry of an already-committed
   *      attempt (see the idempotency-lookup-before-pre-restore-checkpoint
   *      pattern already in this file — the same `existingRecord` check that
   *      gates `savePreRestoreCheckpoint` also gates this lookup).
   *   2. `cancelInactiveUnresolvedBulkOperationById` — cancel THAT SPECIFIC
   *      operation by id, never re-querying "whatever is unresolved now".
   *      Still a safe no-op if, by the time it runs, that operation has
   *      already gone terminal or is under an active lease — see
   *      `bulkSettlementOperation.ts`'s `cancelInactiveUnresolvedBulkSettlementOperation`.
   */
  findUnresolvedBulkOperationId: (lessonRunId: string) => Promise<string | null>
  cancelInactiveUnresolvedBulkOperationById: (operationId: string, nowMillis: number) => Promise<void>
}

export interface RestoreHouseholdCheckpointV2Input {
  lessonRunId: string
  checkpointId: string
  reason: string
  actorUid: string
  idempotencyKey: string
  nowMillis: number
}

export interface RestoreHouseholdCheckpointV2Result {
  newRestoreGeneration: number
  restoredHouseholdIds: string[]
  preRestoreCheckpointId: string
}

/** Same request shape for both schema-version restore flows. */
export type RestoreHouseholdCheckpointV3Input = RestoreHouseholdCheckpointV2Input
export type RestoreHouseholdCheckpointV3Result = RestoreHouseholdCheckpointV2Result

/**
 * Return shape of `restoreHouseholdCheckpointWithAdminSdk`, the schema-version
 * dispatcher — a plain superset of both `RestoreHouseholdCheckpointV2Result`
 * and `RestoreHouseholdCheckpointV3Result` (currently identical) plus which
 * codec actually handled the restore, so a caller (or the client) can tell
 * without a separate manifest fetch.
 */
export interface HouseholdRestoreOperationView {
  newRestoreGeneration: number
  restoredHouseholdIds: string[]
  preRestoreCheckpointId: string
  schemaVersion: 2 | 3
}

export const restoreHouseholdCheckpointV2 = async (
  deps: HouseholdRestoreDeps,
  input: RestoreHouseholdCheckpointV2Input,
): Promise<RestoreHouseholdCheckpointV2Result> => {
  const trimmedReason = input.reason.trim()
  if (!trimmedReason) {
    throw new Error('Reason is required')
  }

  const isLeaseActive = await deps.checkActiveBulkLease(input.lessonRunId, input.nowMillis)
  if (isLeaseActive) {
    throw new Error('Active bulk operation lease is active')
  }

  const keyId = idempotencyDocumentId(input.lessonRunId, input.idempotencyKey)
  const idempotencyPath = `lessonRuns/${input.lessonRunId}/householdCheckpointRestoreIdempotency/${keyId}`
  const digest = requestDigest({
    checkpointId: input.checkpointId,
    reason: trimmedReason,
    actorUid: input.actorUid,
  })

  // Look up any prior attempt for this idempotency key BEFORE calling
  // savePreRestoreCheckpoint: that helper derives its own idempotency digest
  // from the *current* household round indices, which change once the
  // restore transaction below has committed. Calling it again unconditionally
  // on a retry (e.g. one that only failed at the RTDB sync step, after the
  // Firestore restore already succeeded) would compute a different digest
  // than the first attempt and throw 'Idempotency key payload mismatch'
  // instead of resuming the pending RTDB sync.
  const existingRecord = await deps.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(idempotencyPath)
    if (!snap.exists) return null
    return snap.data() as unknown as HouseholdRestoreIdempotencyRecord
  })

  if (existingRecord && existingRecord.requestDigest !== digest) {
    throw new Error('Idempotency key payload mismatch')
  }

  // Cancel any inactive unresolved bulk-settlement operation left over from
  // before this restore — see `HouseholdRestoreDeps.findUnresolvedBulkOperationId`'s
  // doc comment for the race this fixes. Only runs on a genuinely NEW attempt
  // (no `existingRecord` yet) — a retry of an already-committed restore must
  // never re-run this, exactly like `savePreRestoreCheckpoint` below. The
  // candidate id is captured ONCE here and cancelled BY THAT SPECIFIC id,
  // never by a fresh "whatever is unresolved now" re-query.
  if (!existingRecord) {
    const unresolvedOperationId = await deps.findUnresolvedBulkOperationId(input.lessonRunId)
    if (unresolvedOperationId) {
      await deps.cancelInactiveUnresolvedBulkOperationById(unresolvedOperationId, input.nowMillis)
    }
  }

  const preRestoreIdempotencyKey = `pre-restore:${keyId}`
  const preRestore = existingRecord
    ? { checkpointId: existingRecord.preRestoreCheckpointId, created: false }
    : await deps.savePreRestoreCheckpoint({
        lessonRunId: input.lessonRunId,
        actorUid: input.actorUid,
        idempotencyKey: preRestoreIdempotencyKey,
        nowMillis: input.nowMillis,
      })

  const txResult = await deps.firestore.runTransaction(async (tx) => {
    const txAdapter: FirestoreTx = {
      get: async (path) => tx.get(path),
      set: (path, data) => tx.set(path, data),
    }

    // ---- ALL READS FIRST ----
    const idempSnap = await tx.get(idempotencyPath)
    if (idempSnap.exists) {
      const prior = idempSnap.data() as unknown as HouseholdRestoreIdempotencyRecord
      if (prior.requestDigest !== digest) {
        throw new Error('Idempotency key payload mismatch')
      }
      const cpSnap = await tx.get(`lessonRuns/${input.lessonRunId}/checkpoints/${prior.checkpointId}`)
      const cpData = cpSnap.data() as { snapshot?: HouseholdCheckpointSnapshotV2 } | undefined
      const runSnap = await tx.get(`lessonRuns/${input.lessonRunId}`)
      const runData = runSnap.data() as { orgId?: string; restoreGeneration?: number } | undefined
      return {
        record: prior,
        alreadyCommitted: true,
        snapshot: cpData?.snapshot as HouseholdCheckpointSnapshotV2,
        orgId: runData?.orgId ?? '',
        currentRestoreGeneration: typeof runData?.restoreGeneration === 'number' ? runData.restoreGeneration : 0,
      }
    }

    const runPath = `lessonRuns/${input.lessonRunId}`
    const runSnap = await tx.get(runPath)
    if (!runSnap.exists) throw new Error('LessonRun not found')
    const runData = runSnap.data() as { orgId?: string; restoreGeneration?: number }
    const orgId = runData.orgId ?? ''
    const currentGeneration = typeof runData.restoreGeneration === 'number' ? runData.restoreGeneration : 0

    const checkpointPath = `lessonRuns/${input.lessonRunId}/checkpoints/${input.checkpointId}`
    const checkpointSnap = await tx.get(checkpointPath)
    if (!checkpointSnap.exists) throw new Error('Checkpoint not found')
    const checkpointData = checkpointSnap.data() as { snapshot?: unknown }
    const snapshot = checkpointData.snapshot

    if (!isHouseholdCheckpointSnapshotV2(snapshot) || snapshot.scope !== 'ALL_HOUSEHOLDS') {
      throw new Error('復元できるのは v2 かつ ALL_HOUSEHOLDS のチェックポイントのみです')
    }

    // Read all target household states
    for (const household of snapshot.households) {
      await tx.get(`lessonRuns/${input.lessonRunId}/households/${household.householdId}`)
    }

    const newRestoreGeneration = currentGeneration + 1

    // Append LessonEvent (reads counter/idempotency inside read phase)
    const event = await appendLessonEventInTransaction(txAdapter, {
      lessonRunId: input.lessonRunId,
      orgId,
      type: 'CHECKPOINT_RESTORED',
      actorType: 'TEACHER',
      actorId: input.actorUid,
      payload: {
        checkpointId: input.checkpointId,
        reason: trimmedReason,
        restoreGeneration: newRestoreGeneration,
        preRestoreCheckpointId: preRestore.checkpointId,
      },
      idempotencyKey: `restore_${input.lessonRunId}_${keyId}`,
    }, input.nowMillis)

    // ---- ALL WRITES AFTER ----
    tx.set(runPath, {
      ...runData,
      restoreGeneration: newRestoreGeneration,
      updatedAtServerMillis: input.nowMillis,
    })

    for (const household of snapshot.households) {
      const restoredState: HouseholdState = {
        ...household,
        updatedAtServerMillis: input.nowMillis,
      }
      tx.set(`lessonRuns/${input.lessonRunId}/households/${household.householdId}`, restoredState as unknown as Record<string, unknown>)
    }

    const record: HouseholdRestoreIdempotencyRecord = {
      checkpointId: input.checkpointId,
      requestDigest: digest,
      newRestoreGeneration,
      eventId: event.eventId,
      preRestoreCheckpointId: preRestore.checkpointId,
      projectionStatus: 'PENDING',
    }
    tx.set(idempotencyPath, record as unknown as Record<string, unknown>)

    return {
      record,
      alreadyCommitted: false,
      snapshot,
      orgId,
      currentRestoreGeneration: newRestoreGeneration,
    }
  })

  const { record, alreadyCommitted, snapshot, orgId, currentRestoreGeneration } = txResult

  if (alreadyCommitted && record.projectionStatus === 'SYNCED') {
    return {
      newRestoreGeneration: record.newRestoreGeneration,
      restoredHouseholdIds: snapshot.householdIds,
      preRestoreCheckpointId: record.preRestoreCheckpointId,
    }
  }

  if (alreadyCommitted && currentRestoreGeneration !== record.newRestoreGeneration) {
    throw new Error('より新しい世代の復元が行われたため再同期できません')
  }

  // Sync RTDB
  const rtdbUpdates: Record<string, unknown> = {}
  for (const [teamId, teamView] of Object.entries(snapshot.teamViews)) {
    rtdbUpdates[`lessonRunTeamState/${input.lessonRunId}/${teamId}/household`] = teamView
    rtdbUpdates[`lessonRunTeamState/${input.lessonRunId}/${teamId}/orgId`] = orgId
    rtdbUpdates[`lessonRunTeamState/${input.lessonRunId}/${teamId}/updatedAtMillis`] = input.nowMillis
    rtdbUpdates[`lessonRunPrivate/${input.lessonRunId}/householdComputationLog/${teamId}`] = null
  }
  rtdbUpdates[`lessonRunPrivate/${input.lessonRunId}/orgId`] = orgId
  rtdbUpdates[`lessonRunPrivate/${input.lessonRunId}/updatedAtMillis`] = input.nowMillis

  await deps.syncRtdbProjections(rtdbUpdates)

  // Mark SYNCED
  await deps.firestore.runTransaction(async (tx) => {
    const idempotencyPath = `lessonRuns/${input.lessonRunId}/householdCheckpointRestoreIdempotency/${keyId}`
    const snap = await tx.get(idempotencyPath)
    if (snap.exists) {
      const current = snap.data() as unknown as HouseholdRestoreIdempotencyRecord
      tx.set(idempotencyPath, {
        ...current,
        projectionStatus: 'SYNCED',
      })
    }
  })

  return {
    newRestoreGeneration: record.newRestoreGeneration,
    restoredHouseholdIds: snapshot.householdIds,
    preRestoreCheckpointId: record.preRestoreCheckpointId,
  }
}

export const restoreHouseholdCheckpointV2DepsWithAdminSdk = (): HouseholdRestoreDeps => {
  const db = getFirestore()
  const rtdb = getDatabase()
  return {
    firestore: householdRepositoryWithAdminSdk(),
    checkActiveBulkLease: async (lessonRunId, nowMillis) => {
      const active = await findActiveBulkSettlementLeaseWithAdminSdk(lessonRunId, nowMillis)
      return active !== null
    },
    listTeamIds: async (lessonRunId) => {
      const snap = await db.collection(`lessonRuns/${lessonRunId}/teams`).get()
      return snap.docs.map((doc) => doc.id)
    },
    savePreRestoreCheckpoint: async (input) => {
      const runSnap = await db.doc(`lessonRuns/${input.lessonRunId}`).get()
      if (!runSnap.exists) throw new Error('LessonRun not found')
      const templateSnapshot = runSnap.get('templateSnapshot') as { homeEconomics?: HomeEconomicsContent } | undefined
      const homeEconomics = templateSnapshot?.homeEconomics
      if (!homeEconomics) throw new Error('LessonRun has no homeEconomics content')

      const teamsSnap = await db.collection(`lessonRuns/${input.lessonRunId}/teams`).get()
      const teamIds = teamsSnap.docs.map((doc) => doc.id).sort()

      const households: HouseholdState[] = []
      for (const teamId of teamIds) {
        const h = await ensureCommonConditionsHouseholdStateWithAdminSdk(input.lessonRunId, teamId, homeEconomics)
        households.push(h)
      }

      const roundIndices = new Set(households.map((h) => h.roundIndex))
      const expectedRoundIndex = roundIndices.size === 1 ? households[0].roundIndex : null

      return writeHouseholdCheckpointV2({
        firestore: householdRepositoryWithAdminSdk(),
        readTeamView: (teamId, h) => readTeamViewWithAdminSdk(input.lessonRunId, teamId, h, homeEconomics),
        lessonRunId: input.lessonRunId,
        householdIds: teamIds,
        kind: 'PRE_RESTORE',
        label: '復元前自動退避',
        expectedRoundIndex,
        actorUid: input.actorUid,
        idempotencyKey: input.idempotencyKey,
        nowMillis: input.nowMillis,
      })
    },
    syncRtdbProjections: async (updates) => {
      await rtdb.ref().update(updates)
    },
    findUnresolvedBulkOperationId: findUnresolvedBulkSettlementOperationIdWithAdminSdk,
    cancelInactiveUnresolvedBulkOperationById: cancelInactiveUnresolvedBulkSettlementOperationByIdWithAdminSdk,
  }
}

export const restoreHouseholdCheckpointV2WithAdminSdk = (
  input: RestoreHouseholdCheckpointV2Input,
): Promise<RestoreHouseholdCheckpointV2Result> =>
  restoreHouseholdCheckpointV2(restoreHouseholdCheckpointV2DepsWithAdminSdk(), input)

// ---------------------------------------------------------------------------
// v3 (advanced formats: ROLE_VARIANT / STAGE_SPLIT / MULTI_PERSON_PER_TEAM)
// ---------------------------------------------------------------------------

export interface HouseholdRestoreV3Deps {
  firestore: HouseholdFirestoreDeps['firestore']
  checkActiveBulkLease: (lessonRunId: string, nowMillis: number) => Promise<boolean>
  /** See `HouseholdRestoreDeps.findUnresolvedBulkOperationId`'s doc comment. */
  findUnresolvedBulkOperationId: (lessonRunId: string) => Promise<string | null>
  cancelInactiveUnresolvedBulkOperationById: (operationId: string, nowMillis: number) => Promise<void>
  savePreRestoreCheckpoint: (input: {
    lessonRunId: string
    actorUid: string
    idempotencyKey: string
    nowMillis: number
  }) => Promise<{ checkpointId: string; created: boolean }>
  syncRtdbProjections: (updates: Record<string, unknown>) => Promise<void>
}

/**
 * v3 (advanced-format) counterpart to `restoreHouseholdCheckpointV2` —
 * structurally the SAME idempotency-before-pre-restore-checkpoint ordering,
 * crash-safe two-phase commit / RTDB-sync / mark-SYNCED pattern, and
 * "retry never re-increments `restoreGeneration`" property. Differences,
 * per task-8-brief.md:
 *
 * 1. `assignmentRevision` guard: before restoring, the current
 *    `HouseholdAssignmentConfig` must still be `FROZEN` with the SAME
 *    `assignmentRevision` the checkpoint snapshot recorded. Assignments are
 *    immutable once FROZEN (Task 5's finding), so this should never
 *    normally fire — but it is a documented defensive guard against
 *    restoring households against a mismatched team/profile structure,
 *    matching this plan's established "defend anyway" pattern
 *    (`statusTransition.ts`'s own already-FROZEN early-return comment).
 * 2. `HouseholdRuntimeControl` is rewritten to
 *    `{ roundStatus: 'OPEN', activeOperationId: null, synchronizedRoundIndex: <checkpoint's expectedRoundIndex>, assignmentRevision: unchanged }`
 *    in the SAME transaction as the household-state restore — this is the
 *    moment a restore "rewinds the clock" for the synchronized-round
 *    barrier `bulkSettlementOperation.ts` established.
 * 3. Post-commit RTDB sync writes the v3 per-team MULTIPLE-households shape
 *    (`households` + `householdOrder`, keyed by runtime householdId) rather
 *    than v2's single `.household` node, and clears one
 *    `householdComputationLog` entry per RESTORED RUNTIME HOUSEHOLD ID
 *    (not per team) — see this file's own doc note near the RTDB-update
 *    block for the path-shape reasoning (mirrors `processRound.ts`'s own
 *    `householdComputationLog/{householdId}` keying, which already keys by
 *    runtime household id, not team id).
 */
export const restoreHouseholdCheckpointV3 = async (
  deps: HouseholdRestoreV3Deps,
  input: RestoreHouseholdCheckpointV3Input,
): Promise<RestoreHouseholdCheckpointV3Result> => {
  const trimmedReason = input.reason.trim()
  if (!trimmedReason) {
    throw new Error('Reason is required')
  }

  const isLeaseActive = await deps.checkActiveBulkLease(input.lessonRunId, input.nowMillis)
  if (isLeaseActive) {
    throw new Error('Active bulk operation lease is active')
  }

  const keyId = idempotencyDocumentId(input.lessonRunId, input.idempotencyKey)
  const idempotencyPath = `lessonRuns/${input.lessonRunId}/householdCheckpointRestoreIdempotency/${keyId}`
  const digest = requestDigest({
    checkpointId: input.checkpointId,
    reason: trimmedReason,
    actorUid: input.actorUid,
  })

  // Same subtlety as v2: look up any prior attempt BEFORE calling
  // savePreRestoreCheckpoint, whose own idempotency digest depends on
  // CURRENT household state (round indices) that change once the restore
  // transaction below commits.
  const existingRecord = await deps.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(idempotencyPath)
    if (!snap.exists) return null
    return snap.data() as unknown as HouseholdRestoreIdempotencyRecord
  })

  if (existingRecord && existingRecord.requestDigest !== digest) {
    throw new Error('Idempotency key payload mismatch')
  }

  // Same fenced cancel-by-captured-id as v2 — see
  // `HouseholdRestoreDeps.findUnresolvedBulkOperationId`'s doc comment.
  if (!existingRecord) {
    const unresolvedOperationId = await deps.findUnresolvedBulkOperationId(input.lessonRunId)
    if (unresolvedOperationId) {
      await deps.cancelInactiveUnresolvedBulkOperationById(unresolvedOperationId, input.nowMillis)
    }
  }

  const preRestoreIdempotencyKey = `pre-restore:${keyId}`
  const preRestore = existingRecord
    ? { checkpointId: existingRecord.preRestoreCheckpointId, created: false }
    : await deps.savePreRestoreCheckpoint({
        lessonRunId: input.lessonRunId,
        actorUid: input.actorUid,
        idempotencyKey: preRestoreIdempotencyKey,
        nowMillis: input.nowMillis,
      })

  const txResult = await deps.firestore.runTransaction(async (tx) => {
    const txAdapter: FirestoreTx = {
      get: async (path) => tx.get(path),
      set: (path, data) => tx.set(path, data),
    }

    // ---- ALL READS FIRST ----
    const idempSnap = await tx.get(idempotencyPath)
    if (idempSnap.exists) {
      const prior = idempSnap.data() as unknown as HouseholdRestoreIdempotencyRecord
      if (prior.requestDigest !== digest) {
        throw new Error('Idempotency key payload mismatch')
      }
      const cpSnap = await tx.get(`lessonRuns/${input.lessonRunId}/checkpoints/${prior.checkpointId}`)
      const cpData = cpSnap.data() as { snapshot?: HouseholdCheckpointSnapshotV3 } | undefined
      const runSnap = await tx.get(`lessonRuns/${input.lessonRunId}`)
      const runData = runSnap.data() as { orgId?: string; restoreGeneration?: number } | undefined
      return {
        record: prior,
        alreadyCommitted: true,
        snapshot: cpData?.snapshot as HouseholdCheckpointSnapshotV3,
        orgId: runData?.orgId ?? '',
        currentRestoreGeneration: typeof runData?.restoreGeneration === 'number' ? runData.restoreGeneration : 0,
      }
    }

    const runPath = `lessonRuns/${input.lessonRunId}`
    const runSnap = await tx.get(runPath)
    if (!runSnap.exists) throw new Error('LessonRun not found')
    const runData = runSnap.data() as { orgId?: string; restoreGeneration?: number }
    const orgId = runData.orgId ?? ''
    const currentGeneration = typeof runData.restoreGeneration === 'number' ? runData.restoreGeneration : 0

    const checkpointPath = `lessonRuns/${input.lessonRunId}/checkpoints/${input.checkpointId}`
    const checkpointSnap = await tx.get(checkpointPath)
    if (!checkpointSnap.exists) throw new Error('Checkpoint not found')
    const checkpointData = checkpointSnap.data() as { snapshot?: unknown }
    const snapshot = checkpointData.snapshot

    if (!isHouseholdCheckpointSnapshotV3(snapshot) || snapshot.scope !== 'ALL_HOUSEHOLDS') {
      throw new Error('復元できるのは v3 かつ ALL_HOUSEHOLDS のチェックポイントのみです')
    }

    const controlPath = `lessonRuns/${input.lessonRunId}/householdRuntime/control`
    const controlSnap = await tx.get(controlPath)
    if (!controlSnap.exists) throw new Error('HouseholdRuntimeControl not found')
    const control = controlSnap.data() as unknown as HouseholdRuntimeControl

    // Defensive assignmentRevision guard (see this function's doc comment).
    const assignmentConfigPath = `lessonRuns/${input.lessonRunId}/householdAssignment/config`
    const assignmentConfigSnap = await tx.get(assignmentConfigPath)
    if (!assignmentConfigSnap.exists) throw new Error('HouseholdAssignment not found')
    const assignmentConfig = assignmentConfigSnap.data() as unknown as HouseholdAssignmentConfig
    if (assignmentConfig.state !== 'FROZEN') {
      throw new Error('HouseholdAssignment is not FROZEN')
    }
    if (assignmentConfig.assignmentRevision !== snapshot.assignmentRevision) {
      throw new Error('HouseholdAssignment assignmentRevision does not match the checkpoint snapshot')
    }

    // Read all target household states
    for (const householdId of snapshot.householdIds) {
      await tx.get(`lessonRuns/${input.lessonRunId}/households/${householdId}`)
    }

    const newRestoreGeneration = currentGeneration + 1

    // Append LessonEvent (reads counter/idempotency inside read phase)
    const event = await appendLessonEventInTransaction(txAdapter, {
      lessonRunId: input.lessonRunId,
      orgId,
      type: 'CHECKPOINT_RESTORED',
      actorType: 'TEACHER',
      actorId: input.actorUid,
      payload: {
        checkpointId: input.checkpointId,
        reason: trimmedReason,
        restoreGeneration: newRestoreGeneration,
        preRestoreCheckpointId: preRestore.checkpointId,
      },
      idempotencyKey: `restore_${input.lessonRunId}_${keyId}`,
    }, input.nowMillis)

    // ---- ALL WRITES AFTER ----
    tx.set(runPath, {
      ...runData,
      restoreGeneration: newRestoreGeneration,
      updatedAtServerMillis: input.nowMillis,
    })

    for (const household of snapshot.householdStates) {
      const restoredState: HouseholdState = {
        ...household,
        updatedAtServerMillis: input.nowMillis,
      }
      tx.set(`lessonRuns/${input.lessonRunId}/households/${household.householdId}`, restoredState as unknown as Record<string, unknown>)
    }

    // Control "rewinds the clock": OPEN, no active op, synchronized round
    // set to whatever round the checkpoint expected, assignmentRevision
    // left unchanged (already re-verified above).
    tx.set(controlPath, {
      ...control,
      roundStatus: 'OPEN',
      activeOperationId: null,
      synchronizedRoundIndex: snapshot.expectedRoundIndex,
      updatedAtServerMillis: input.nowMillis,
    } as unknown as Record<string, unknown>)

    const record: HouseholdRestoreIdempotencyRecord = {
      checkpointId: input.checkpointId,
      requestDigest: digest,
      newRestoreGeneration,
      eventId: event.eventId,
      preRestoreCheckpointId: preRestore.checkpointId,
      projectionStatus: 'PENDING',
    }
    tx.set(idempotencyPath, record as unknown as Record<string, unknown>)

    return {
      record,
      alreadyCommitted: false,
      snapshot,
      orgId,
      currentRestoreGeneration: newRestoreGeneration,
    }
  })

  const { record, alreadyCommitted, snapshot, orgId, currentRestoreGeneration } = txResult

  if (alreadyCommitted && record.projectionStatus === 'SYNCED') {
    return {
      newRestoreGeneration: record.newRestoreGeneration,
      restoredHouseholdIds: snapshot.householdIds,
      preRestoreCheckpointId: record.preRestoreCheckpointId,
    }
  }

  if (alreadyCommitted && currentRestoreGeneration !== record.newRestoreGeneration) {
    throw new Error('より新しい世代の復元が行われたため再同期できません')
  }

  // Sync RTDB — v3 shape: `HouseholdCheckpointTeamViewV3`'s own field names
  // (`households`/`householdOrder`) imply the advanced per-team RTDB
  // projection node mirrors that shape directly, the same way v2's single
  // `.household` node mirrors `HouseholdStateTeamView` directly. Task 9 (not
  // yet built) owns actually READING this path during live play; writing it
  // now during restore is forward-compatible and correct regardless of
  // Task 9's eventual reader, since it is simply "whatever the checkpoint
  // says this team's households looked like" — the same relationship v2's
  // restore already has to its own RTDB node.
  // Critical C1 fix: also republish the control-derived trio
  // (`courseFormat`/`synchronizedRoundIndex`/`roundStatus`) that the
  // transaction above just reset on the Firestore control doc — the v3
  // restore write previously carried `households`/`householdOrder`/`orgId`/
  // `updatedAtMillis` only, leaving each team's RTDB node stuck at whatever
  // `roundStatus` it showed before the restore (often `'SETTLING'`, if the
  // restore was itself recovering from a stuck bulk operation), even though
  // the restore always rewinds the control doc to `roundStatus: 'OPEN'` at
  // `snapshot.expectedRoundIndex`. `snapshot.courseFormat`/
  // `expectedRoundIndex` are used here (not a separate control re-read)
  // since they are exactly what the transaction above wrote to the control
  // doc, and are already in scope on both the fresh-restore and
  // already-committed-replay paths.
  const controlTrio = advancedTeamControlStateFields({
    courseFormat: snapshot.courseFormat,
    synchronizedRoundIndex: snapshot.expectedRoundIndex,
    roundStatus: 'OPEN',
  })

  const rtdbUpdates: Record<string, unknown> = {}
  for (const [teamId, teamView] of Object.entries(snapshot.teamViews)) {
    rtdbUpdates[`lessonRunTeamState/${input.lessonRunId}/${teamId}/households`] = teamView.households
    rtdbUpdates[`lessonRunTeamState/${input.lessonRunId}/${teamId}/householdOrder`] = teamView.householdOrder
    rtdbUpdates[`lessonRunTeamState/${input.lessonRunId}/${teamId}/courseFormat`] = controlTrio.courseFormat
    rtdbUpdates[`lessonRunTeamState/${input.lessonRunId}/${teamId}/synchronizedRoundIndex`] = controlTrio.synchronizedRoundIndex
    rtdbUpdates[`lessonRunTeamState/${input.lessonRunId}/${teamId}/roundStatus`] = controlTrio.roundStatus
    rtdbUpdates[`lessonRunTeamState/${input.lessonRunId}/${teamId}/orgId`] = orgId
    rtdbUpdates[`lessonRunTeamState/${input.lessonRunId}/${teamId}/updatedAtMillis`] = input.nowMillis
    // Clear stale computation-log entries per RESTORED RUNTIME HOUSEHOLD id
    // (not per team) — `processRound.ts` already keys
    // `householdComputationLog` by runtime `householdId`, so this mirrors
    // that existing convention rather than guessing a new one.
    for (const householdId of teamView.householdOrder) {
      rtdbUpdates[`lessonRunPrivate/${input.lessonRunId}/householdComputationLog/${householdId}`] = null
    }
  }
  rtdbUpdates[`lessonRunPrivate/${input.lessonRunId}/orgId`] = orgId
  rtdbUpdates[`lessonRunPrivate/${input.lessonRunId}/updatedAtMillis`] = input.nowMillis

  await deps.syncRtdbProjections(rtdbUpdates)

  // Mark SYNCED
  await deps.firestore.runTransaction(async (tx) => {
    const idempotencyPath = `lessonRuns/${input.lessonRunId}/householdCheckpointRestoreIdempotency/${keyId}`
    const snap = await tx.get(idempotencyPath)
    if (snap.exists) {
      const current = snap.data() as unknown as HouseholdRestoreIdempotencyRecord
      tx.set(idempotencyPath, {
        ...current,
        projectionStatus: 'SYNCED',
      })
    }
  })

  return {
    newRestoreGeneration: record.newRestoreGeneration,
    restoredHouseholdIds: snapshot.householdIds,
    preRestoreCheckpointId: record.preRestoreCheckpointId,
  }
}

export const restoreHouseholdCheckpointV3DepsWithAdminSdk = (): HouseholdRestoreV3Deps => {
  const db = getFirestore()
  const rtdb = getDatabase()
  return {
    firestore: householdRepositoryWithAdminSdk(),
    checkActiveBulkLease: async (lessonRunId, nowMillis) => {
      const active = await findActiveBulkSettlementLeaseWithAdminSdk(lessonRunId, nowMillis)
      return active !== null
    },
    findUnresolvedBulkOperationId: findUnresolvedBulkSettlementOperationIdWithAdminSdk,
    cancelInactiveUnresolvedBulkOperationById: cancelInactiveUnresolvedBulkSettlementOperationByIdWithAdminSdk,
    savePreRestoreCheckpoint: async (input) => {
      const controlSnap = await db.doc(`lessonRuns/${input.lessonRunId}/householdRuntime/control`).get()
      if (!controlSnap.exists) throw new Error('HouseholdRuntimeControl not found')
      const control = controlSnap.data() as unknown as HouseholdRuntimeControl

      const runSnap = await db.doc(`lessonRuns/${input.lessonRunId}`).get()
      if (!runSnap.exists) throw new Error('LessonRun not found')
      const templateSnapshot = runSnap.get('templateSnapshot') as { homeEconomics?: HomeEconomicsContent } | undefined
      const homeEconomics = templateSnapshot?.homeEconomics
      if (!homeEconomics) throw new Error('LessonRun has no homeEconomics content')

      const entriesSnap = await db.collection(`lessonRuns/${input.lessonRunId}/householdAssignment/config/entries`).get()
      const householdIds = entriesSnap.docs
        .map((doc) => (doc.data() as unknown as HouseholdAssignmentEntry).householdId)
        .sort()

      const visibleConcepts = resolveVisibleConcepts(homeEconomics.goalPackage)

      return writeHouseholdCheckpointV3({
        firestore: householdRepositoryWithAdminSdk(),
        lessonRunId: input.lessonRunId,
        courseFormat: control.courseFormat,
        householdIds,
        assignmentRevision: control.assignmentRevision,
        kind: 'PRE_RESTORE',
        label: '復元前自動退避',
        expectedRoundIndex: control.synchronizedRoundIndex,
        actorUid: input.actorUid,
        idempotencyKey: input.idempotencyKey,
        nowMillis: input.nowMillis,
        visibleConcepts,
        profiles: homeEconomics.households,
      })
    },
    syncRtdbProjections: async (updates) => {
      await rtdb.ref().update(updates)
    },
  }
}

export const restoreHouseholdCheckpointV3WithAdminSdk = (
  input: RestoreHouseholdCheckpointV3Input,
): Promise<RestoreHouseholdCheckpointV3Result> =>
  restoreHouseholdCheckpointV3(restoreHouseholdCheckpointV3DepsWithAdminSdk(), input)

// ---------------------------------------------------------------------------
// Schema-version dispatcher — retains the external restore Callable shape
// (`onCall.ts`'s `restoreHouseholdCheckpointCallable` calls THIS instead of
// calling `restoreHouseholdCheckpointV2WithAdminSdk` directly), routing
// internally by the target checkpoint's `snapshot.schemaVersion`.
//
// Split into a pure `restoreHouseholdCheckpoint` (deps-injected, matching
// this file's usual pure-function + `WithAdminSdk`-wrapper pattern) and a
// thin `restoreHouseholdCheckpointWithAdminSdk` wrapper, so the routing
// logic itself is directly unit-testable against a fake/injected backing
// instead of only being reachable through a whole-module mock.
// ---------------------------------------------------------------------------

export interface HouseholdRestoreDispatchDeps {
  /** Fetches the checkpoint's stored `snapshot` (or throws if not found). */
  getCheckpointSnapshot: (lessonRunId: string, checkpointId: string) => Promise<unknown>
  restoreV2: (input: RestoreHouseholdCheckpointV2Input) => Promise<RestoreHouseholdCheckpointV2Result>
  restoreV3: (input: RestoreHouseholdCheckpointV3Input) => Promise<RestoreHouseholdCheckpointV3Result>
}

export const restoreHouseholdCheckpoint = async (
  deps: HouseholdRestoreDispatchDeps,
  input: RestoreHouseholdCheckpointV2Input,
): Promise<HouseholdRestoreOperationView> => {
  const snapshot = await deps.getCheckpointSnapshot(input.lessonRunId, input.checkpointId)

  // Only dispatch to v3 for an actual v3 snapshot. Everything else
  // (v2, v1, malformed) falls through to v2's own restore flow — that
  // flow already carries its own precise schema/scope validation
  // ('復元できるのは v2 かつ ALL_HOUSEHOLDS のチェックポイントのみです'), so
  // this dispatcher does not duplicate that check or its error message;
  // it just needs to correctly route the one case (v3) that would
  // otherwise be misrouted into v2's incompatible restore logic.
  if (isHouseholdCheckpointSnapshotV3(snapshot)) {
    const result = await deps.restoreV3(input)
    return { ...result, schemaVersion: 3 }
  }
  const result = await deps.restoreV2(input)
  return { ...result, schemaVersion: 2 }
}

export const restoreHouseholdCheckpointWithAdminSdk = (
  input: RestoreHouseholdCheckpointV2Input,
): Promise<HouseholdRestoreOperationView> => {
  const db = getFirestore()
  return restoreHouseholdCheckpoint(
    {
      getCheckpointSnapshot: async (lessonRunId, checkpointId) => {
        const checkpointSnap = await db.doc(`lessonRuns/${lessonRunId}/checkpoints/${checkpointId}`).get()
        if (!checkpointSnap.exists) throw new Error('Checkpoint not found')
        return checkpointSnap.data()?.snapshot
      },
      restoreV2: restoreHouseholdCheckpointV2WithAdminSdk,
      restoreV3: restoreHouseholdCheckpointV3WithAdminSdk,
    },
    input,
  )
}

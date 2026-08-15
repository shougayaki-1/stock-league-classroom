import { getFirestore } from 'firebase-admin/firestore'
import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'
import {
  acquireBulkSettlementLease,
  cancelBulkSettlementOperation,
  createOrReplayBulkSettlementOperation,
  createOrReplayBulkSettlementOperationWithControlLock,
  finalizeBulkSettlementOperation,
  findUnresolvedBulkSettlementOperationWithAdminSdk,
  getBulkSettlementOperationWithAdminSdk,
  heartbeatBulkSettlementLease,
  setPreSettlementCheckpointId,
  toHouseholdBulkSettlementOperationView,
  updateHouseholdBulkItemStatus,
  type HouseholdBulkItemStatus,
  type HouseholdBulkSettlementOperation,
  type HouseholdBulkSettlementOperationView,
  type HouseholdBulkTarget,
} from './bulkSettlementOperation'
import {
  getHouseholdDecisionForRoundWithAdminSdk,
  getHouseholdRuntimeControlWithAdminSdk,
  getHouseholdStateWithAdminSdk,
  householdRepositoryWithAdminSdk,
  type HouseholdDecisionRecord,
  type HouseholdState,
} from '../lessonRuns/households/repository'
import {
  ensureCommonConditionsHouseholdStateWithAdminSdk,
} from './commonConditionsHousehold'
import { ensureAssignedHouseholdStateWithAdminSdk } from './assignedHousehold'
import {
  readTeamViewWithAdminSdk,
  writeHouseholdCheckpointV2,
} from './householdCheckpoint'
import { processRoundWithAdminSdk, type ProcessRoundExecutionResult, type ProcessRoundInput } from './processRound'
import { idempotencyDocumentId, requestDigest } from '../lib/idempotency'
import type { AdvancedHouseholdCourseFormat, HouseholdAssignmentEntry } from './householdAssignment'
import type { HouseholdAssignmentConfig } from './householdAssignmentRepository'
import type { HouseholdRuntimeControl } from './statusTransition'

/**
 * This module's own private "which course formats are advanced" set —
 * mirrors `statusTransition.ts`/`onCall.ts`'s own private
 * `ADVANCED_FORMATS`/`isAdvancedHouseholdCourseFormat` (each file keeps this
 * small set local rather than sharing an export, per those files' own
 * doc comments).
 */
const ADVANCED_FORMATS = new Set<AdvancedHouseholdCourseFormat>([
  'ROLE_VARIANT', 'STAGE_SPLIT', 'MULTI_PERSON_PER_TEAM',
])
const isAdvancedHouseholdCourseFormat = (value: string): value is AdvancedHouseholdCourseFormat =>
  ADVANCED_FORMATS.has(value as AdvancedHouseholdCourseFormat)

export interface BulkSettlementDeps {
  readLessonRun: (lessonRunId: string) => Promise<{
    status: string
    subject: string
    courseFormat: string
    restoreGeneration: number
  }>
  /**
   * `null` for COMMON_CONDITIONS (no `HouseholdRuntimeControl` document
   * exists for that format). For the 3 advanced formats, the CURRENT
   * control document, read OUTSIDE any transaction — used only to learn the
   * `assignmentRevision` to lock against; `createOrReplayOperationWithControlLock`
   * re-reads and re-verifies it fresh INSIDE its own transaction, same
   * "outer read to decide what to attempt, inner re-verify before writing"
   * shape Task 5's `submitHouseholdDecisionCallable` already uses.
   */
  readRuntimeControl: (lessonRunId: string) => Promise<HouseholdRuntimeControl | null>
  /**
   * Enumerates the (householdId, teamId, profileId) triples to settle.
   * COMMON_CONDITIONS: one target per team (`householdId === teamId`).
   * Advanced formats: one target per FROZEN `HouseholdAssignmentEntry`.
   */
  listTargets: (lessonRunId: string, courseFormat: string) => Promise<HouseholdBulkTarget[]>
  createOrReplayOperation: (input: {
    lessonRunId: string
    idempotencyKey: string
    actorUid: string
    expectedRoundIndex: number
    restoreGeneration: number
    forceUnsubmitted: boolean
    targets: HouseholdBulkTarget[]
    nowMillis: number
  }) => Promise<HouseholdBulkSettlementOperation>
  createOrReplayOperationWithControlLock: (input: {
    lessonRunId: string
    idempotencyKey: string
    actorUid: string
    expectedRoundIndex: number
    restoreGeneration: number
    assignmentRevision: number
    forceUnsubmitted: boolean
    targets: HouseholdBulkTarget[]
    nowMillis: number
  }) => Promise<HouseholdBulkSettlementOperation>
  acquireLease: (input: {
    operationId: string
    actorUid: string
    nowMillis: number
  }) => Promise<HouseholdBulkSettlementOperation>
  heartbeatLease: (input: {
    operationId: string
    nowMillis: number
  }) => Promise<HouseholdBulkSettlementOperation>
  ensureHousehold: (lessonRunId: string, target: HouseholdBulkTarget, courseFormat: string) => Promise<HouseholdState>
  readHouseholdState: (lessonRunId: string, householdId: string) => Promise<HouseholdState | null>
  readHouseholdDecision: (lessonRunId: string, householdId: string, roundIndex: number) => Promise<HouseholdDecisionRecord | null>
  /**
   * Task 7 checkpoint seam: Common keeps writing the REAL v2 checkpoint
   * (`writeHouseholdCheckpointV2`). Advanced formats route through this SAME
   * dependency slot (never skipped — see the doc comment on
   * `bulkSettlementDepsWithAdminSdk`'s wiring below) so Task 7 can swap in
   * the real v3 advanced writer without touching this call site or its
   * orchestration logic; Task 6's own unit tests inject a fake advanced
   * writer here to prove the seam is exercised.
   */
  writePreSettlementCheckpoint: (input: {
    lessonRunId: string
    householdIds: string[]
    kind: 'PRE_SETTLEMENT'
    label: string
    expectedRoundIndex: number
    actorUid: string
    idempotencyKey: string
    nowMillis: number
    courseFormat: string
  }) => Promise<{ checkpointId: string; created: boolean }>
  setOperationCheckpointId: (operationId: string, checkpointId: string) => Promise<HouseholdBulkSettlementOperation>
  processRoundFn: (input: ProcessRoundInput) => Promise<ProcessRoundExecutionResult>
  updateItemStatus: (input: {
    operationId: string
    householdId: string
    status: HouseholdBulkItemStatus
    errorCode?: string
    errorMessage?: string
    nowMillis: number
  }) => Promise<HouseholdBulkSettlementOperation>
  finalizeOperation: (input: {
    operationId: string
    status: 'COMPLETED' | 'FAILED'
    nowMillis: number
  }) => Promise<HouseholdBulkSettlementOperation>
  /** Preflight-cancel: the operation never processed any item — see `cancelBulkSettlementOperation`'s doc comment for why this is distinct from `finalizeOperation`. */
  cancelOperation: (input: {
    operationId: string
    nowMillis: number
  }) => Promise<HouseholdBulkSettlementOperation>
  getOperation: (operationId: string) => Promise<HouseholdBulkSettlementOperation | null>
  findUnresolvedOperation: (lessonRunId: string) => Promise<HouseholdBulkSettlementOperation | null>
}

export interface ProcessHouseholdRoundBatchInput {
  lessonRunId: string
  expectedRoundIndex: number
  forceUnsubmitted: boolean
  actorUid: string
  idempotencyKey: string
  nowMillis: number
}

export const processHouseholdRoundBatch = async (
  deps: BulkSettlementDeps,
  input: ProcessHouseholdRoundBatchInput,
): Promise<HouseholdBulkSettlementOperationView> => {
  const run = await deps.readLessonRun(input.lessonRunId)
  if (run.status !== 'RUNNING') {
    throw new Error('このレッスンは実行中ではないため、この操作はできません。')
  }
  if (run.subject !== 'HOME_ECONOMICS') {
    throw new Error('LessonRun subject is not HOME_ECONOMICS')
  }
  const isAdvanced = isAdvancedHouseholdCourseFormat(run.courseFormat)
  if (run.courseFormat !== 'COMMON_CONDITIONS' && !isAdvanced) {
    throw new Error('LessonRun course format is not supported for bulk settlement')
  }

  const operationId = idempotencyDocumentId(input.lessonRunId, input.idempotencyKey)
  const unresolved = await deps.findUnresolvedOperation(input.lessonRunId)
  if (unresolved && unresolved.operationId !== operationId) {
    throw new Error('前の未完了の一括決算が存在します')
  }

  const targets = await deps.listTargets(input.lessonRunId, run.courseFormat)
  targets.sort((a, b) => a.householdId.localeCompare(b.householdId))

  let op: HouseholdBulkSettlementOperation
  if (isAdvanced) {
    const control = await deps.readRuntimeControl(input.lessonRunId)
    if (!control) throw new Error('HouseholdRuntimeControl not found')
    op = await deps.createOrReplayOperationWithControlLock({
      lessonRunId: input.lessonRunId,
      idempotencyKey: input.idempotencyKey,
      actorUid: input.actorUid,
      expectedRoundIndex: input.expectedRoundIndex,
      restoreGeneration: run.restoreGeneration,
      assignmentRevision: control.assignmentRevision,
      forceUnsubmitted: input.forceUnsubmitted,
      targets,
      nowMillis: input.nowMillis,
    })
  } else {
    op = await deps.createOrReplayOperation({
      lessonRunId: input.lessonRunId,
      idempotencyKey: input.idempotencyKey,
      actorUid: input.actorUid,
      expectedRoundIndex: input.expectedRoundIndex,
      restoreGeneration: run.restoreGeneration,
      forceUnsubmitted: input.forceUnsubmitted,
      targets,
      nowMillis: input.nowMillis,
    })
  }

  op = await deps.acquireLease({
    operationId: op.operationId,
    actorUid: input.actorUid,
    nowMillis: input.nowMillis,
  })

  for (const target of targets) {
    await deps.ensureHousehold(input.lessonRunId, target, run.courseFormat)
  }

  // Pre-validate states and decisions. A failure here means NO item has been
  // attempted yet.
  //
  // Advanced formats: the operation is CANCELLED (not FAILED) and the
  // control-document `roundStatus: SETTLING` lock acquired above is released
  // immediately — see `cancelBulkSettlementOperation`'s doc comment.
  //
  // Common (COMMON_CONDITIONS): keeps its pre-existing FAILED path. Common
  // never acquires a control-document lock, so there is nothing to release,
  // and the teacher dashboard UI (`HouseholdTeacherDashboard.tsx`) depends on
  // `status === 'FAILED'` to surface an error banner + retry button — CANCELLED
  // operations are treated as already-resolved and would disappear silently.
  const preflightFail = async (reason: string): Promise<never> => {
    if (isAdvanced) {
      await deps.cancelOperation({ operationId: op.operationId, nowMillis: input.nowMillis })
    } else {
      await deps.finalizeOperation({ operationId: op.operationId, status: 'FAILED', nowMillis: input.nowMillis })
    }
    throw new Error(reason)
  }

  for (const target of targets) {
    const state = await deps.readHouseholdState(input.lessonRunId, target.householdId)
    if (!state || state.roundIndex !== input.expectedRoundIndex) {
      await preflightFail('家庭間でラウンドが不一致または期待ラウンドと異なります')
    }

    const decision = await deps.readHouseholdDecision(input.lessonRunId, target.householdId, input.expectedRoundIndex)
    if (!decision && !input.forceUnsubmitted) {
      await preflightFail('未提出の家庭が存在するため一括決算できません')
    }
  }

  // Checkpoint PRE_SETTLEMENT once
  if (!op.preSettlementCheckpointId) {
    const cpResult = await deps.writePreSettlementCheckpoint({
      lessonRunId: input.lessonRunId,
      householdIds: targets.map((target) => target.householdId),
      kind: 'PRE_SETTLEMENT',
      label: `第${input.expectedRoundIndex + 1}ラウンド 決算前`,
      expectedRoundIndex: input.expectedRoundIndex,
      actorUid: input.actorUid,
      idempotencyKey: `pre-settlement:${op.operationId}`,
      nowMillis: input.nowMillis,
      courseFormat: run.courseFormat,
    })
    op = await deps.setOperationCheckpointId(op.operationId, cpResult.checkpointId)
  }

  return executeBulkItems(deps, op, input.expectedRoundIndex, input.forceUnsubmitted, input.actorUid)
}

export interface RetryHouseholdRoundBatchInput {
  lessonRunId: string
  operationId: string
  actorUid: string
  nowMillis: number
}

export const retryHouseholdRoundBatch = async (
  deps: BulkSettlementDeps,
  input: RetryHouseholdRoundBatchInput,
): Promise<HouseholdBulkSettlementOperationView> => {
  let op = await deps.getOperation(input.operationId)
  if (!op) throw new Error('Bulk settlement operation not found')

  if (op.lessonRunId !== input.lessonRunId) {
    throw new Error('LessonRun ID mismatch')
  }
  if (op.actorUid !== input.actorUid) {
    throw new Error('Actor UID mismatch')
  }

  if (op.status === 'COMPLETED') {
    return toHouseholdBulkSettlementOperationView(op, input.nowMillis)
  }
  if (op.status === 'CANCELLED') {
    return toHouseholdBulkSettlementOperationView(op, input.nowMillis)
  }

  const run = await deps.readLessonRun(input.lessonRunId)
  if (run.restoreGeneration !== op.restoreGeneration) {
    throw new Error('チェックポイント復元が行われたため、この一括処理は再試行できません')
  }

  op = await deps.acquireLease({
    operationId: op.operationId,
    actorUid: input.actorUid,
    nowMillis: input.nowMillis,
  })

  return executeBulkItems(deps, op, op.expectedRoundIndex, op.forceUnsubmitted, input.actorUid)
}

const executeBulkItems = async (
  deps: BulkSettlementDeps,
  operation: HouseholdBulkSettlementOperation,
  expectedRoundIndex: number,
  forceUnsubmitted: boolean,
  actorUid: string,
): Promise<HouseholdBulkSettlementOperationView> => {
  let op = operation
  const sortedHouseholdIds = Object.keys(op.households).sort()

  for (const householdId of sortedHouseholdIds) {
    if (op.households[householdId]?.status === 'SUCCEEDED') {
      continue
    }

    await deps.heartbeatLease({
      operationId: op.operationId,
      nowMillis: Date.now(),
    })

    const state = await deps.readHouseholdState(op.lessonRunId, householdId)
    if (!state) {
      op = await deps.updateItemStatus({
        operationId: op.operationId,
        householdId,
        status: 'FAILED',
        errorCode: 'NOT_FOUND',
        errorMessage: 'Household state not found',
        nowMillis: Date.now(),
      })
      continue
    }

    if (state.roundIndex === expectedRoundIndex + 1) {
      op = await deps.updateItemStatus({
        operationId: op.operationId,
        householdId,
        status: 'SUCCEEDED',
        nowMillis: Date.now(),
      })
      continue
    }

    if (state.roundIndex !== expectedRoundIndex) {
      op = await deps.updateItemStatus({
        operationId: op.operationId,
        householdId,
        status: 'FAILED',
        errorCode: 'ROUND_MISMATCH',
        errorMessage: `Household is at round ${state.roundIndex}, expected ${expectedRoundIndex}`,
        nowMillis: Date.now(),
      })
      continue
    }

    const decision = await deps.readHouseholdDecision(op.lessonRunId, householdId, expectedRoundIndex)
    const forceSettle = forceUnsubmitted && decision === null

    // Mark RUNNING before the actual settlement call, so a crash mid-item
    // is distinguishable on retry from an item that was never attempted
    // (PENDING). `executeBulkItems` only ever skips SUCCEEDED items, so a
    // stale RUNNING item left by a crash is simply re-attempted like
    // PENDING/FAILED ones — no special-casing needed on retry.
    op = await deps.updateItemStatus({
      operationId: op.operationId,
      householdId,
      status: 'RUNNING',
      nowMillis: Date.now(),
    })

    try {
      const execResult = await deps.processRoundFn({
        lessonRunId: op.lessonRunId,
        householdId,
        actorId: actorUid,
        forceSettle,
      })

      if (
        execResult.status === 'COMMITTED' ||
        (execResult.status === 'ALREADY_SETTLED' && execResult.householdState.roundIndex === expectedRoundIndex + 1)
      ) {
        op = await deps.updateItemStatus({
          operationId: op.operationId,
          householdId,
          status: 'SUCCEEDED',
          nowMillis: Date.now(),
        })
      } else {
        op = await deps.updateItemStatus({
          operationId: op.operationId,
          householdId,
          status: 'FAILED',
          errorCode: 'ALREADY_SETTLED_MISMATCH',
          errorMessage: 'Already settled with incompatible round',
          nowMillis: Date.now(),
        })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      op = await deps.updateItemStatus({
        operationId: op.operationId,
        householdId,
        status: 'FAILED',
        errorCode: 'EXECUTION_ERROR',
        errorMessage: msg,
        nowMillis: Date.now(),
      })
    }
  }

  const allSucceeded = Object.values(op.households).every((item) => item.status === 'SUCCEEDED')
  const finalStatus = allSucceeded ? 'COMPLETED' : 'FAILED'

  op = await deps.finalizeOperation({
    operationId: op.operationId,
    status: finalStatus,
    nowMillis: Date.now(),
  })

  return toHouseholdBulkSettlementOperationView(op, Date.now())
}

/**
 * Task 6 interim advanced pre-settlement checkpoint writer. Deliberately
 * NOT `writeHouseholdCheckpointV2` reused as-is: that function's
 * `readTeamView` keys its `teamViews` map by `HouseholdState.teamId`
 * (`householdCheckpoint.ts`), which silently loses information for
 * MULTI_PERSON_PER_TEAM (several runtime households sharing one `teamId`
 * would overwrite each other's view). Rather than produce a checkpoint
 * that is subtly wrong for one of the three advanced formats, this writes
 * a minimal-but-real, idempotent placeholder checkpoint (same
 * idempotency-replay discipline, all reads before all writes) recording
 * which households it covers — enough to exist, be queryable, and keep
 * `preSettlementCheckpointId` a real id — WITHOUT claiming full v3
 * restore-fidelity. Task 7 replaces this with a proper v3 writer that
 * captures full per-household state, without changing this call site's
 * shape (`BulkSettlementDeps.writePreSettlementCheckpoint`).
 */
const writeAdvancedPreSettlementCheckpointPlaceholderWithAdminSdk = async (input: {
  lessonRunId: string
  householdIds: string[]
  kind: 'PRE_SETTLEMENT'
  label: string
  expectedRoundIndex: number
  actorUid: string
  idempotencyKey: string
  nowMillis: number
}): Promise<{ checkpointId: string; created: boolean }> => {
  const db = getFirestore()
  return db.runTransaction(async (tx) => {
    const keyId = idempotencyDocumentId(input.lessonRunId, input.idempotencyKey)
    const mappingPath = `lessonRuns/${input.lessonRunId}/householdCheckpointAdvancedPlaceholderIdempotency/${keyId}`
    const digest = requestDigest({
      kind: input.kind,
      label: input.label,
      expectedRoundIndex: input.expectedRoundIndex,
      actorUid: input.actorUid,
    })

    // ---- ALL READS FIRST ----
    const mappingRef = db.doc(mappingPath)
    const mappingSnap = await tx.get(mappingRef)
    if (mappingSnap.exists) {
      const prior = mappingSnap.data() as { checkpointId: string; requestDigest: string }
      if (prior.requestDigest !== digest) throw new Error('Idempotency key payload mismatch')
      return { checkpointId: prior.checkpointId, created: false }
    }

    const runRef = db.doc(`lessonRuns/${input.lessonRunId}`)
    const runSnap = await tx.get(runRef)
    if (!runSnap.exists) throw new Error('LessonRun not found')
    const runData = runSnap.data() as { restoreGeneration?: number } | undefined
    const restoreGeneration = typeof runData?.restoreGeneration === 'number' ? runData.restoreGeneration : 0

    // ---- ALL WRITES AFTER ----
    const checkpointId = `hcp_${restoreGeneration}_${keyId.slice(0, 20)}`
    const checkpointDoc = {
      id: checkpointId,
      lessonRunId: input.lessonRunId,
      restoreGeneration,
      requestDigest: digest,
      createdAtServerMillis: input.nowMillis,
      snapshot: {
        version: 'v3-placeholder' as const,
        kind: input.kind,
        label: input.label,
        expectedRoundIndex: input.expectedRoundIndex,
        householdIds: [...input.householdIds].sort(),
        createdByUid: input.actorUid,
        createdAtServerMillis: input.nowMillis,
      },
    }
    tx.set(db.doc(`lessonRuns/${input.lessonRunId}/checkpoints/${checkpointId}`), checkpointDoc)
    tx.set(mappingRef, { checkpointId, requestDigest: digest })
    return { checkpointId, created: true }
  })
}

export const bulkSettlementDepsWithAdminSdk = (): BulkSettlementDeps => {
  const db = getFirestore()
  return {
    readLessonRun: async (lessonRunId) => {
      const snap = await db.doc(`lessonRuns/${lessonRunId}`).get()
      if (!snap.exists) throw new Error('LessonRun not found')
      const data = snap.data() as {
        status?: string
        subject?: string
        restoreGeneration?: number
        templateSnapshot?: { homeEconomics?: HomeEconomicsContent }
      }
      return {
        status: data.status ?? '',
        subject: data.subject ?? '',
        courseFormat: data.templateSnapshot?.homeEconomics?.courseFormat ?? '',
        restoreGeneration: typeof data.restoreGeneration === 'number' ? data.restoreGeneration : 0,
      }
    },
    readRuntimeControl: getHouseholdRuntimeControlWithAdminSdk,
    listTargets: async (lessonRunId, courseFormat) => {
      if (courseFormat === 'COMMON_CONDITIONS') {
        const teamsSnap = await db.collection(`lessonRuns/${lessonRunId}/teams`).get()
        const teamIds = teamsSnap.docs.map((doc) => doc.id)
        const runSnap = await db.doc(`lessonRuns/${lessonRunId}`).get()
        const templateSnapshot = runSnap.get('templateSnapshot') as { homeEconomics?: HomeEconomicsContent } | undefined
        const homeEconomics = templateSnapshot?.homeEconomics
        if (!homeEconomics) throw new Error('LessonRun has no homeEconomics content')
        const commonProfileId = homeEconomics.households[0]?.householdId ?? ''
        return teamIds.map((teamId) => ({ householdId: teamId, teamId, profileId: commonProfileId }))
      }

      const configSnap = await db.doc(`lessonRuns/${lessonRunId}/householdAssignment/config`).get()
      if (!configSnap.exists) throw new Error('HouseholdAssignment has not been prepared for this lesson yet')
      const config = configSnap.data() as unknown as HouseholdAssignmentConfig
      if (config.state !== 'FROZEN') throw new Error(`HouseholdAssignment must be FROZEN before bulk settlement (current state: ${config.state})`)

      const entriesSnap = await db.collection(`lessonRuns/${lessonRunId}/householdAssignment/config/entries`).get()
      return entriesSnap.docs.map((doc) => {
        const entry = doc.data() as unknown as HouseholdAssignmentEntry
        return { householdId: entry.householdId, teamId: entry.teamId, profileId: entry.profileId }
      })
    },
    createOrReplayOperation: (input) =>
      createOrReplayBulkSettlementOperation({
        ...input,
        assignmentRevision: null,
        firestore: householdRepositoryWithAdminSdk(),
      }),
    createOrReplayOperationWithControlLock: (input) =>
      createOrReplayBulkSettlementOperationWithControlLock({
        ...input,
        firestore: householdRepositoryWithAdminSdk(),
      }),
    acquireLease: (input) =>
      acquireBulkSettlementLease({
        ...input,
        firestore: householdRepositoryWithAdminSdk(),
      }),
    heartbeatLease: (input) =>
      heartbeatBulkSettlementLease({
        ...input,
        firestore: householdRepositoryWithAdminSdk(),
      }),
    ensureHousehold: (lessonRunId, target, courseFormat) =>
      courseFormat === 'COMMON_CONDITIONS'
        ? ensureCommonConditionsHouseholdStateWithAdminSdk(lessonRunId, target.teamId)
        : ensureAssignedHouseholdStateWithAdminSdk(lessonRunId, target.householdId),
    readHouseholdState: getHouseholdStateWithAdminSdk,
    readHouseholdDecision: getHouseholdDecisionForRoundWithAdminSdk,
    writePreSettlementCheckpoint: async (input) => {
      if (input.courseFormat !== 'COMMON_CONDITIONS') {
        return writeAdvancedPreSettlementCheckpointPlaceholderWithAdminSdk(input)
      }

      const runSnap = await db.doc(`lessonRuns/${input.lessonRunId}`).get()
      const templateSnapshot = runSnap.get('templateSnapshot') as { homeEconomics?: HomeEconomicsContent } | undefined
      const homeEconomics = templateSnapshot?.homeEconomics
      if (!homeEconomics) throw new Error('LessonRun has no homeEconomics content')

      return writeHouseholdCheckpointV2({
        ...input,
        firestore: householdRepositoryWithAdminSdk(),
        readTeamView: (teamId, h) => readTeamViewWithAdminSdk(input.lessonRunId, teamId, h, homeEconomics),
      })
    },
    setOperationCheckpointId: async (opId, cpId) =>
      setPreSettlementCheckpointId({
        firestore: householdRepositoryWithAdminSdk(),
        operationId: opId,
        checkpointId: cpId,
        nowMillis: Date.now(),
      }),
    processRoundFn: processRoundWithAdminSdk,
    updateItemStatus: (input) =>
      updateHouseholdBulkItemStatus({
        ...input,
        firestore: householdRepositoryWithAdminSdk(),
      }),
    finalizeOperation: (input) =>
      finalizeBulkSettlementOperation({
        ...input,
        firestore: householdRepositoryWithAdminSdk(),
      }),
    cancelOperation: (input) =>
      cancelBulkSettlementOperation({
        ...input,
        firestore: householdRepositoryWithAdminSdk(),
      }),
    getOperation: getBulkSettlementOperationWithAdminSdk,
    findUnresolvedOperation: findUnresolvedBulkSettlementOperationWithAdminSdk,
  }
}

export const processHouseholdRoundBatchWithAdminSdk = (
  input: ProcessHouseholdRoundBatchInput,
): Promise<HouseholdBulkSettlementOperationView> =>
  processHouseholdRoundBatch(bulkSettlementDepsWithAdminSdk(), input)

export const retryHouseholdRoundBatchWithAdminSdk = (
  input: RetryHouseholdRoundBatchInput,
): Promise<HouseholdBulkSettlementOperationView> =>
  retryHouseholdRoundBatch(bulkSettlementDepsWithAdminSdk(), input)

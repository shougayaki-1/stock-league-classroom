import { getFirestore } from 'firebase-admin/firestore'
import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'
import {
  acquireBulkSettlementLease,
  createOrReplayBulkSettlementOperation,
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
} from './bulkSettlementOperation'
import {
  getHouseholdDecisionForRoundWithAdminSdk,
  getHouseholdStateWithAdminSdk,
  householdRepositoryWithAdminSdk,
  type HouseholdDecisionRecord,
  type HouseholdState,
} from '../lessonRuns/households/repository'
import {
  ensureCommonConditionsHouseholdStateWithAdminSdk,
} from './commonConditionsHousehold'
import {
  readTeamViewWithAdminSdk,
  writeHouseholdCheckpointV2,
} from './householdCheckpoint'
import { processRoundWithAdminSdk, type ProcessRoundExecutionResult, type ProcessRoundInput } from './processRound'
import { idempotencyDocumentId } from '../lib/idempotency'

export interface BulkSettlementDeps {
  readLessonRun: (lessonRunId: string) => Promise<{
    status: string
    subject: string
    courseFormat: string
    restoreGeneration: number
  }>
  listTeamIds: (lessonRunId: string) => Promise<string[]>
  createOrReplayOperation: (input: {
    lessonRunId: string
    idempotencyKey: string
    actorUid: string
    expectedRoundIndex: number
    restoreGeneration: number
    forceUnsubmitted: boolean
    teamIds: string[]
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
  ensureHousehold: (lessonRunId: string, teamId: string) => Promise<HouseholdState>
  readHouseholdState: (lessonRunId: string, teamId: string) => Promise<HouseholdState | null>
  readHouseholdDecision: (lessonRunId: string, teamId: string, roundIndex: number) => Promise<HouseholdDecisionRecord | null>
  writePreSettlementCheckpoint: (input: {
    lessonRunId: string
    householdIds: string[]
    kind: 'PRE_SETTLEMENT'
    label: string
    expectedRoundIndex: number
    actorUid: string
    idempotencyKey: string
    nowMillis: number
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
  if (run.courseFormat !== 'COMMON_CONDITIONS') {
    throw new Error('LessonRun course format must be COMMON_CONDITIONS')
  }

  const operationId = idempotencyDocumentId(input.lessonRunId, input.idempotencyKey)
  const unresolved = await deps.findUnresolvedOperation(input.lessonRunId)
  if (unresolved && unresolved.operationId !== operationId) {
    throw new Error('前の未完了の一括決算が存在します')
  }

  const teamIds = await deps.listTeamIds(input.lessonRunId)
  teamIds.sort()

  let op = await deps.createOrReplayOperation({
    lessonRunId: input.lessonRunId,
    idempotencyKey: input.idempotencyKey,
    actorUid: input.actorUid,
    expectedRoundIndex: input.expectedRoundIndex,
    restoreGeneration: run.restoreGeneration,
    forceUnsubmitted: input.forceUnsubmitted,
    teamIds,
    nowMillis: input.nowMillis,
  })

  op = await deps.acquireLease({
    operationId: op.operationId,
    actorUid: input.actorUid,
    nowMillis: input.nowMillis,
  })

  for (const teamId of teamIds) {
    await deps.ensureHousehold(input.lessonRunId, teamId)
  }

  // Pre-validate states and decisions
  for (const teamId of teamIds) {
    const state = await deps.readHouseholdState(input.lessonRunId, teamId)
    if (!state || state.roundIndex !== input.expectedRoundIndex) {
      await deps.finalizeOperation({
        operationId: op.operationId,
        status: 'FAILED',
        nowMillis: input.nowMillis,
      })
      throw new Error('家庭間でラウンドが不一致または期待ラウンドと異なります')
    }

    const decision = await deps.readHouseholdDecision(input.lessonRunId, teamId, input.expectedRoundIndex)
    if (!decision && !input.forceUnsubmitted) {
      await deps.finalizeOperation({
        operationId: op.operationId,
        status: 'FAILED',
        nowMillis: input.nowMillis,
      })
      throw new Error('未提出の家庭が存在するため一括決算できません')
    }
  }

  // Checkpoint PRE_SETTLEMENT once
  if (!op.preSettlementCheckpointId) {
    const cpResult = await deps.writePreSettlementCheckpoint({
      lessonRunId: input.lessonRunId,
      householdIds: teamIds,
      kind: 'PRE_SETTLEMENT',
      label: `第${input.expectedRoundIndex + 1}ラウンド 決算前`,
      expectedRoundIndex: input.expectedRoundIndex,
      actorUid: input.actorUid,
      idempotencyKey: `pre-settlement:${op.operationId}`,
      nowMillis: input.nowMillis,
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
  const sortedTeamIds = Object.keys(op.households).sort()

  for (const teamId of sortedTeamIds) {
    if (op.households[teamId]?.status === 'SUCCEEDED') {
      continue
    }

    await deps.heartbeatLease({
      operationId: op.operationId,
      nowMillis: Date.now(),
    })

    const state = await deps.readHouseholdState(op.lessonRunId, teamId)
    if (!state) {
      op = await deps.updateItemStatus({
        operationId: op.operationId,
        householdId: teamId,
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
        householdId: teamId,
        status: 'SUCCEEDED',
        nowMillis: Date.now(),
      })
      continue
    }

    if (state.roundIndex !== expectedRoundIndex) {
      op = await deps.updateItemStatus({
        operationId: op.operationId,
        householdId: teamId,
        status: 'FAILED',
        errorCode: 'ROUND_MISMATCH',
        errorMessage: `Household is at round ${state.roundIndex}, expected ${expectedRoundIndex}`,
        nowMillis: Date.now(),
      })
      continue
    }

    const decision = await deps.readHouseholdDecision(op.lessonRunId, teamId, expectedRoundIndex)
    const forceSettle = forceUnsubmitted && decision === null

    try {
      const execResult = await deps.processRoundFn({
        lessonRunId: op.lessonRunId,
        householdId: teamId,
        actorId: actorUid,
        forceSettle,
      })

      if (
        execResult.status === 'COMMITTED' ||
        (execResult.status === 'ALREADY_SETTLED' && execResult.householdState.roundIndex === expectedRoundIndex + 1)
      ) {
        op = await deps.updateItemStatus({
          operationId: op.operationId,
          householdId: teamId,
          status: 'SUCCEEDED',
          nowMillis: Date.now(),
        })
      } else {
        op = await deps.updateItemStatus({
          operationId: op.operationId,
          householdId: teamId,
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
        householdId: teamId,
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
    listTeamIds: async (lessonRunId) => {
      const snap = await db.collection(`lessonRuns/${lessonRunId}/teams`).get()
      return snap.docs.map((doc) => doc.id)
    },
    createOrReplayOperation: (input) =>
      createOrReplayBulkSettlementOperation({
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
    ensureHousehold: (runId, teamId) => ensureCommonConditionsHouseholdStateWithAdminSdk(runId, teamId),
    readHouseholdState: getHouseholdStateWithAdminSdk,
    readHouseholdDecision: getHouseholdDecisionForRoundWithAdminSdk,
    writePreSettlementCheckpoint: async (input) => {
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

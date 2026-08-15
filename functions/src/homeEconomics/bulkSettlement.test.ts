import { describe, expect, it, vi } from 'vitest'
import {
  processHouseholdRoundBatch,
  retryHouseholdRoundBatch,
  type BulkSettlementDeps,
} from './bulkSettlement'
import type { HouseholdState } from '../lessonRuns/households/repository'
import type { HouseholdBulkSettlementOperation } from './bulkSettlementOperation'
import type { ProcessRoundExecutionResult } from './processRound'

describe('bulkSettlement', () => {
  const makeBaseHousehold = (teamId: string, roundIndex = 1): HouseholdState => ({
    householdId: teamId,
    lessonRunId: 'run-1',
    teamId,
    profileId: teamId,
    cashYen: 1000000,
    assetHoldingsYen: {},
    activeInsuranceContracts: {},
    activeLiabilities: {},
    lifeStage: 'INDEPENDENT',
    roundIndex,
    goalDelayedRounds: 0,
    updatedAtServerMillis: 1000,
  })

  const makeDeps = (overrides: Partial<BulkSettlementDeps> = {}): BulkSettlementDeps => {
    let operation: HouseholdBulkSettlementOperation = {
      operationId: 'op-1',
      lessonRunId: 'run-1',
      actorUid: 'teacher-1',
      expectedRoundIndex: 1,
      restoreGeneration: 0,
      forceUnsubmitted: false,
      status: 'PENDING',
      preSettlementCheckpointId: null,
      requestDigest: 'digest-1',
      attempt: 0,
      leaseExpiresAtServerMillis: null,
      lastHeartbeatAtServerMillis: null,
      households: {
        'team-a': { status: 'PENDING' },
        'team-b': { status: 'PENDING' },
      },
      createdAtServerMillis: 1000,
      updatedAtServerMillis: 1000,
    }

    const householdStates: Record<string, HouseholdState> = {
      'team-a': makeBaseHousehold('team-a', 1),
      'team-b': makeBaseHousehold('team-b', 1),
    }

    const decisions: Record<string, boolean> = {
      'team-a': true,
      'team-b': true,
    }

    const deps: BulkSettlementDeps = {
      readLessonRun: vi.fn().mockResolvedValue({
        status: 'RUNNING',
        subject: 'HOME_ECONOMICS',
        courseFormat: 'COMMON_CONDITIONS',
        restoreGeneration: 0,
      }),
      listTeamIds: vi.fn().mockResolvedValue(['team-a', 'team-b']),
      createOrReplayOperation: vi.fn().mockImplementation(async (input) => {
        operation = {
          ...operation,
          lessonRunId: input.lessonRunId,
          actorUid: input.actorUid,
          expectedRoundIndex: input.expectedRoundIndex,
          restoreGeneration: input.restoreGeneration,
          forceUnsubmitted: input.forceUnsubmitted,
          households: Object.fromEntries(input.teamIds.map((id: string) => [id, { status: 'PENDING' }])),
        }
        return operation
      }),
      acquireLease: vi.fn().mockImplementation(async (input) => {
        const current = (await deps.getOperation(input.operationId)) ?? operation
        operation = { ...current, status: 'RUNNING', attempt: current.attempt + 1, leaseExpiresAtServerMillis: Date.now() + 60000 }
        return operation
      }),
      heartbeatLease: vi.fn().mockImplementation(async () => {
        operation = { ...operation, leaseExpiresAtServerMillis: Date.now() + 60000 }
        return operation
      }),
      ensureHousehold: vi.fn().mockImplementation(async (_runId, teamId) => {
        return householdStates[teamId]
      }),
      readHouseholdState: vi.fn().mockImplementation(async (_runId, teamId) => {
        return householdStates[teamId]
      }),
      readHouseholdDecision: vi.fn().mockImplementation(async (_runId, teamId, round) => {
        if (!decisions[teamId]) return null
        return { decisionId: `dec-${teamId}-${round}` }
      }),
      writePreSettlementCheckpoint: vi.fn().mockResolvedValue({ checkpointId: 'cp-pre-1', created: true }),
      setOperationCheckpointId: vi.fn().mockImplementation(async (_opId, cpId) => {
        operation = { ...operation, preSettlementCheckpointId: cpId }
        return operation
      }),
      processRoundFn: vi.fn().mockImplementation(async (input): Promise<ProcessRoundExecutionResult> => {
        const current = householdStates[input.householdId]
        householdStates[input.householdId] = { ...current, roundIndex: current.roundIndex + 1 }
        return {
          status: 'COMMITTED',
          settlement: {
            newHouseholdState: householdStates[input.householdId],
            occurredEventIds: [],
            incomeYen: 100,
            expensesYen: 50,
            netCashFlowYen: 50,
            shortfallYen: 0,
            insuranceBenefitsYen: 0,
            shortfallOptionsConsidered: [],
          },
        }
      }),
      updateItemStatus: vi.fn().mockImplementation(async (input) => {
        operation = {
          ...operation,
          households: {
            ...operation.households,
            [input.householdId]: { status: input.status, errorCode: input.errorCode, errorMessage: input.errorMessage },
          },
        }
        return operation
      }),
      finalizeOperation: vi.fn().mockImplementation(async (input) => {
        operation = { ...operation, status: input.status, leaseExpiresAtServerMillis: null }
        return operation
      }),
      getOperation: vi.fn().mockImplementation(async () => operation),
      findUnresolvedOperation: vi.fn().mockResolvedValue(null),
      ...overrides,
    }

    return deps
  }

  describe('processHouseholdRoundBatch preflight', () => {
    it('rejects if LessonRun status is not RUNNING', async () => {
      const deps = makeDeps({
        readLessonRun: vi.fn().mockResolvedValue({
          status: 'PAUSED',
          subject: 'HOME_ECONOMICS',
          courseFormat: 'COMMON_CONDITIONS',
          restoreGeneration: 0,
        }),
      })

      await expect(
        processHouseholdRoundBatch(deps, {
          lessonRunId: 'run-1',
          expectedRoundIndex: 1,
          forceUnsubmitted: false,
          actorUid: 'teacher-1',
          idempotencyKey: 'key-1',
          nowMillis: 1000,
        }),
      ).rejects.toThrow('実行中ではない')
    })

    it('rejects if subject is not HOME_ECONOMICS or format is not COMMON_CONDITIONS', async () => {
      const deps = makeDeps({
        readLessonRun: vi.fn().mockResolvedValue({
          status: 'RUNNING',
          subject: 'SOCIAL_STUDIES',
          courseFormat: 'COMMON_CONDITIONS',
          restoreGeneration: 0,
        }),
      })

      await expect(
        processHouseholdRoundBatch(deps, {
          lessonRunId: 'run-1',
          expectedRoundIndex: 1,
          forceUnsubmitted: false,
          actorUid: 'teacher-1',
          idempotencyKey: 'key-1',
          nowMillis: 1000,
        }),
      ).rejects.toThrow('HOME_ECONOMICS')
    })

    it('rejects normal settlement when any household has not submitted decision without mutating or checkpointing', async () => {
      const deps = makeDeps({
        readHouseholdDecision: vi.fn().mockImplementation(async (_runId, teamId) => {
          if (teamId === 'team-b') return null
          return { decisionId: 'dec-1' }
        }),
      })

      await expect(
        processHouseholdRoundBatch(deps, {
          lessonRunId: 'run-1',
          expectedRoundIndex: 1,
          forceUnsubmitted: false,
          actorUid: 'teacher-1',
          idempotencyKey: 'key-1',
          nowMillis: 1000,
        }),
      ).rejects.toThrow('未提出')

      expect(deps.writePreSettlementCheckpoint).not.toHaveBeenCalled()
      expect(deps.processRoundFn).not.toHaveBeenCalled()
      expect(deps.finalizeOperation).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }))
    })
  })

  describe('processHouseholdRoundBatch execution', () => {
    it('executes bulk settlement successfully for all submitted households', async () => {
      const deps = makeDeps()
      const result = await processHouseholdRoundBatch(deps, {
        lessonRunId: 'run-1',
        expectedRoundIndex: 1,
        forceUnsubmitted: false,
        actorUid: 'teacher-1',
        idempotencyKey: 'key-1',
        nowMillis: 1000,
      })

      expect(result.status).toBe('COMPLETED')
      expect(result.households['team-a'].status).toBe('SUCCEEDED')
      expect(result.households['team-b'].status).toBe('SUCCEEDED')
      expect(deps.writePreSettlementCheckpoint).toHaveBeenCalledOnce()
      expect(deps.processRoundFn).toHaveBeenCalledTimes(2)
      expect(deps.finalizeOperation).toHaveBeenCalledWith(expect.objectContaining({ status: 'COMPLETED' }))
    })

    it('forces settlement when forceUnsubmitted is true', async () => {
      const deps = makeDeps({
        readHouseholdDecision: vi.fn().mockImplementation(async (_runId, teamId) => {
          if (teamId === 'team-b') return null
          return { decisionId: 'dec-1' }
        }),
      })

      const result = await processHouseholdRoundBatch(deps, {
        lessonRunId: 'run-1',
        expectedRoundIndex: 1,
        forceUnsubmitted: true,
        actorUid: 'teacher-1',
        idempotencyKey: 'key-1',
        nowMillis: 1000,
      })

      expect(result.status).toBe('COMPLETED')
      expect(deps.processRoundFn).toHaveBeenCalledWith(expect.objectContaining({
        householdId: 'team-b',
        forceSettle: true,
      }))
    })

    it('handles partial failure and records failed item without completing operation', async () => {
      const deps = makeDeps({
        processRoundFn: vi.fn().mockImplementation(async (input) => {
          if (input.householdId === 'team-b') {
            throw new Error('Simulation crash')
          }
          return {
            status: 'COMMITTED',
            settlement: {} as never,
          }
        }),
      })

      const result = await processHouseholdRoundBatch(deps, {
        lessonRunId: 'run-1',
        expectedRoundIndex: 1,
        forceUnsubmitted: false,
        actorUid: 'teacher-1',
        idempotencyKey: 'key-1',
        nowMillis: 1000,
      })

      expect(result.status).toBe('FAILED')
      expect(result.households['team-a'].status).toBe('SUCCEEDED')
      expect(result.households['team-b'].status).toBe('FAILED')
      expect(result.households['team-b'].errorMessage).toContain('Simulation crash')
      expect(deps.finalizeOperation).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }))
    })
  })

  describe('retryHouseholdRoundBatch', () => {
    it('retries only non-SUCCEEDED items and preserves already SUCCEEDED items', async () => {
      let op: HouseholdBulkSettlementOperation = {
        operationId: 'op-1',
        lessonRunId: 'run-1',
        actorUid: 'teacher-1',
        expectedRoundIndex: 1,
        restoreGeneration: 0,
        forceUnsubmitted: false,
        status: 'FAILED',
        preSettlementCheckpointId: 'cp-1',
        requestDigest: 'digest-1',
        attempt: 1,
        leaseExpiresAtServerMillis: null,
        lastHeartbeatAtServerMillis: 1000,
        households: {
          'team-a': { status: 'SUCCEEDED' },
          'team-b': { status: 'FAILED', errorCode: 'ERR', errorMessage: 'Simulation crash' },
        },
        createdAtServerMillis: 1000,
        updatedAtServerMillis: 2000,
      }

      const deps = makeDeps({
        getOperation: vi.fn().mockImplementation(async () => op),
        updateItemStatus: vi.fn().mockImplementation(async (input) => {
          op = {
            ...op,
            households: {
              ...op.households,
              [input.householdId]: { status: input.status, errorCode: input.errorCode, errorMessage: input.errorMessage },
            },
          }
          return op
        }),
        finalizeOperation: vi.fn().mockImplementation(async (input) => {
          op = { ...op, status: input.status, leaseExpiresAtServerMillis: null }
          return op
        }),
      })

      const result = await retryHouseholdRoundBatch(deps, {
        lessonRunId: 'run-1',
        operationId: 'op-1',
        actorUid: 'teacher-1',
        nowMillis: 3000,
      })

      expect(result.status).toBe('COMPLETED')
      expect(result.households['team-a'].status).toBe('SUCCEEDED')
      expect(result.households['team-b'].status).toBe('SUCCEEDED')
      // team-a was already SUCCEEDED, so processRound should only be called once for team-b
      expect(deps.processRoundFn).toHaveBeenCalledTimes(1)
      expect(deps.processRoundFn).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'team-b' }))
    })
  })
})

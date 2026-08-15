import { describe, expect, it, vi } from 'vitest'
import {
  processHouseholdRoundBatch,
  retryHouseholdRoundBatch,
  type BulkSettlementDeps,
} from './bulkSettlement'
import type { HouseholdState } from '../lessonRuns/households/repository'
import type { HouseholdBulkSettlementOperation, HouseholdBulkTarget } from './bulkSettlementOperation'
import type { ProcessRoundExecutionResult } from './processRound'
import type { HouseholdRuntimeControl } from './statusTransition'

describe('bulkSettlement', () => {
  const commonTargets: HouseholdBulkTarget[] = [
    { householdId: 'team-a', teamId: 'team-a', profileId: 'profile-common' },
    { householdId: 'team-b', teamId: 'team-b', profileId: 'profile-common' },
  ]

  const makeBaseHousehold = (householdId: string, roundIndex = 1): HouseholdState => ({
    householdId,
    lessonRunId: 'run-1',
    teamId: householdId,
    profileId: 'profile-common',
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
      assignmentRevision: null,
      forceUnsubmitted: false,
      status: 'PENDING',
      preSettlementCheckpointId: null,
      requestDigest: 'digest-1',
      attempt: 0,
      leaseExpiresAtServerMillis: null,
      lastHeartbeatAtServerMillis: null,
      households: {
        'team-a': { status: 'PENDING', teamId: 'team-a', profileId: 'profile-common' },
        'team-b': { status: 'PENDING', teamId: 'team-b', profileId: 'profile-common' },
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
      readRuntimeControl: vi.fn().mockResolvedValue(null),
      listTargets: vi.fn().mockResolvedValue(commonTargets),
      createOrReplayOperation: vi.fn().mockImplementation(async (input) => {
        operation = {
          ...operation,
          lessonRunId: input.lessonRunId,
          actorUid: input.actorUid,
          expectedRoundIndex: input.expectedRoundIndex,
          restoreGeneration: input.restoreGeneration,
          forceUnsubmitted: input.forceUnsubmitted,
          assignmentRevision: null,
          households: Object.fromEntries(
            input.targets.map((t: HouseholdBulkTarget) => [t.householdId, { status: 'PENDING', teamId: t.teamId, profileId: t.profileId }]),
          ),
        }
        return operation
      }),
      createOrReplayOperationWithControlLock: vi.fn().mockImplementation(async (input) => {
        operation = {
          ...operation,
          lessonRunId: input.lessonRunId,
          actorUid: input.actorUid,
          expectedRoundIndex: input.expectedRoundIndex,
          restoreGeneration: input.restoreGeneration,
          forceUnsubmitted: input.forceUnsubmitted,
          assignmentRevision: input.assignmentRevision,
          households: Object.fromEntries(
            input.targets.map((t: HouseholdBulkTarget) => [t.householdId, { status: 'PENDING', teamId: t.teamId, profileId: t.profileId }]),
          ),
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
      ensureHousehold: vi.fn().mockImplementation(async (_runId, target) => {
        return householdStates[target.householdId]
      }),
      readHouseholdState: vi.fn().mockImplementation(async (_runId, householdId) => {
        return householdStates[householdId]
      }),
      readHouseholdDecision: vi.fn().mockImplementation(async (_runId, householdId, round) => {
        if (!decisions[householdId]) return null
        return { decisionId: `dec-${householdId}-${round}` }
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
        const prior = operation.households[input.householdId]
        operation = {
          ...operation,
          households: {
            ...operation.households,
            [input.householdId]: {
              teamId: prior?.teamId ?? input.householdId,
              profileId: prior?.profileId ?? 'profile-common',
              status: input.status,
              errorCode: input.errorCode,
              errorMessage: input.errorMessage,
            },
          },
        }
        return operation
      }),
      finalizeOperation: vi.fn().mockImplementation(async (input) => {
        operation = { ...operation, status: input.status, leaseExpiresAtServerMillis: null }
        return operation
      }),
      cancelOperation: vi.fn().mockImplementation(async () => {
        operation = { ...operation, status: 'CANCELLED', leaseExpiresAtServerMillis: null }
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

    it('rejects an unsupported course format', async () => {
      const deps = makeDeps({
        readLessonRun: vi.fn().mockResolvedValue({
          status: 'RUNNING',
          subject: 'HOME_ECONOMICS',
          courseFormat: 'SOMETHING_ELSE',
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
      ).rejects.toThrow('not supported')
    })

    it('rejects normal settlement when any household has not submitted decision, FAILING the operation (Common has no control-lock to release, and the teacher dashboard depends on FAILED to show its error banner + retry button) without mutating or checkpointing', async () => {
      const deps = makeDeps({
        readHouseholdDecision: vi.fn().mockImplementation(async (_runId, householdId) => {
          if (householdId === 'team-b') return null
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
      expect(deps.cancelOperation).not.toHaveBeenCalled()
      expect(deps.finalizeOperation).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: 'op-1', status: 'FAILED' }),
      )
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
      expect(deps.createOrReplayOperationWithControlLock).not.toHaveBeenCalled()
    })

    it('marks each item RUNNING before settling it', async () => {
      const deps = makeDeps()
      await processHouseholdRoundBatch(deps, {
        lessonRunId: 'run-1',
        expectedRoundIndex: 1,
        forceUnsubmitted: false,
        actorUid: 'teacher-1',
        idempotencyKey: 'key-1',
        nowMillis: 1000,
      })

      expect(deps.updateItemStatus).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'team-a', status: 'RUNNING' }))
      expect(deps.updateItemStatus).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'team-b', status: 'RUNNING' }))
    })

    it('forces settlement when forceUnsubmitted is true', async () => {
      const deps = makeDeps({
        readHouseholdDecision: vi.fn().mockImplementation(async (_runId, householdId) => {
          if (householdId === 'team-b') return null
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
        assignmentRevision: null,
        forceUnsubmitted: false,
        status: 'FAILED',
        preSettlementCheckpointId: 'cp-1',
        requestDigest: 'digest-1',
        attempt: 1,
        leaseExpiresAtServerMillis: null,
        lastHeartbeatAtServerMillis: 1000,
        households: {
          'team-a': { status: 'SUCCEEDED', teamId: 'team-a', profileId: 'profile-common' },
          'team-b': { status: 'FAILED', teamId: 'team-b', profileId: 'profile-common', errorCode: 'ERR', errorMessage: 'Simulation crash' },
        },
        createdAtServerMillis: 1000,
        updatedAtServerMillis: 2000,
      }

      const deps = makeDeps({
        getOperation: vi.fn().mockImplementation(async () => op),
        updateItemStatus: vi.fn().mockImplementation(async (input) => {
          const prior = op.households[input.householdId]
          op = {
            ...op,
            households: {
              ...op.households,
              [input.householdId]: {
                teamId: prior?.teamId ?? input.householdId,
                profileId: prior?.profileId ?? 'profile-common',
                status: input.status,
                errorCode: input.errorCode,
                errorMessage: input.errorMessage,
              },
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

    it('returns the view unchanged for an already-CANCELLED operation without acquiring a lease', async () => {
      const cancelledOp: HouseholdBulkSettlementOperation = {
        operationId: 'op-1', lessonRunId: 'run-1', actorUid: 'teacher-1', expectedRoundIndex: 1,
        restoreGeneration: 0, assignmentRevision: 5, forceUnsubmitted: false, status: 'CANCELLED',
        preSettlementCheckpointId: null, requestDigest: 'd', attempt: 0, leaseExpiresAtServerMillis: null,
        lastHeartbeatAtServerMillis: null, households: {}, createdAtServerMillis: 1000, updatedAtServerMillis: 1000,
      }
      const deps = makeDeps({ getOperation: vi.fn().mockResolvedValue(cancelledOp) })

      const result = await retryHouseholdRoundBatch(deps, {
        lessonRunId: 'run-1', operationId: 'op-1', actorUid: 'teacher-1', nowMillis: 3000,
      })

      expect(result.status).toBe('CANCELLED')
      expect(deps.acquireLease).not.toHaveBeenCalled()
    })
  })

  describe('advanced course formats (Task 6)', () => {
    const advancedTargets: HouseholdBulkTarget[] = [
      { householdId: 'hh-a', teamId: 'team-a', profileId: 'profile-x' },
      { householdId: 'hh-b', teamId: 'team-b', profileId: 'profile-y' },
    ]

    const advancedControl: HouseholdRuntimeControl = {
      courseFormat: 'ROLE_VARIANT',
      assignmentRevision: 7,
      synchronizedRoundIndex: 1,
      roundStatus: 'OPEN',
      activeOperationId: null,
      updatedAtServerMillis: 500,
    }

    const makeAdvancedDeps = (overrides: Partial<BulkSettlementDeps> = {}): BulkSettlementDeps => {
      const advancedHouseholdStates: Record<string, HouseholdState> = {
        'hh-a': makeBaseHousehold('hh-a', 1),
        'hh-b': makeBaseHousehold('hh-b', 1),
      }
      const advancedDecisions: Record<string, boolean> = { 'hh-a': true, 'hh-b': true }

      return makeDeps({
        readLessonRun: vi.fn().mockResolvedValue({
          status: 'RUNNING',
          subject: 'HOME_ECONOMICS',
          courseFormat: 'ROLE_VARIANT',
          restoreGeneration: 0,
        }),
        readRuntimeControl: vi.fn().mockResolvedValue(advancedControl),
        listTargets: vi.fn().mockResolvedValue(advancedTargets),
        ensureHousehold: vi.fn().mockImplementation(async (_runId, target) => advancedHouseholdStates[target.householdId]),
        readHouseholdState: vi.fn().mockImplementation(async (_runId, householdId) => advancedHouseholdStates[householdId]),
        readHouseholdDecision: vi.fn().mockImplementation(async (_runId, householdId, round) => {
          if (!advancedDecisions[householdId]) return null
          return { decisionId: `dec-${householdId}-${round}` }
        }),
        processRoundFn: vi.fn().mockImplementation(async (input): Promise<ProcessRoundExecutionResult> => {
          const current = advancedHouseholdStates[input.householdId]
          advancedHouseholdStates[input.householdId] = { ...current, roundIndex: current.roundIndex + 1 }
          return {
            status: 'COMMITTED',
            settlement: {
              newHouseholdState: advancedHouseholdStates[input.householdId],
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
        ...overrides,
      })
    }

    it('atomically creates the operation via the control-lock path (not the unlocked Common path) and threads assignmentRevision through, never trusting a client-supplied value', async () => {
      const deps = makeAdvancedDeps()
      const result = await processHouseholdRoundBatch(deps, {
        lessonRunId: 'run-1',
        expectedRoundIndex: 1,
        forceUnsubmitted: false,
        actorUid: 'teacher-1',
        idempotencyKey: 'key-1',
        nowMillis: 1000,
      })

      expect(result.status).toBe('COMPLETED')
      expect(deps.createOrReplayOperation).not.toHaveBeenCalled()
      expect(deps.createOrReplayOperationWithControlLock).toHaveBeenCalledWith(expect.objectContaining({
        assignmentRevision: 7, // taken from the server-read control doc, not from client input
        expectedRoundIndex: 1,
        targets: advancedTargets,
      }))
    })

    it('preflight-cancel: missing required decision with force=false cancels the operation and releases the lock before the API surfaces the validation failure', async () => {
      const deps = makeAdvancedDeps({
        readHouseholdDecision: vi.fn().mockImplementation(async (_runId, householdId) => {
          if (householdId === 'hh-b') return null
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

      expect(deps.cancelOperation).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'op-1' }))
      expect(deps.processRoundFn).not.toHaveBeenCalled()
      expect(deps.writePreSettlementCheckpoint).not.toHaveBeenCalled()
    })

    it('dispatches ensureHousehold to the advanced initializer (not the Common one) for every target', async () => {
      const deps = makeAdvancedDeps()
      await processHouseholdRoundBatch(deps, {
        lessonRunId: 'run-1',
        expectedRoundIndex: 1,
        forceUnsubmitted: false,
        actorUid: 'teacher-1',
        idempotencyKey: 'key-1',
        nowMillis: 1000,
      })

      expect(deps.ensureHousehold).toHaveBeenCalledWith('run-1', advancedTargets[0], 'ROLE_VARIANT')
      expect(deps.ensureHousehold).toHaveBeenCalledWith('run-1', advancedTargets[1], 'ROLE_VARIANT')
    })

    it('routes the pre-settlement checkpoint call through the injected (fake, Task 7 seam) advanced writer, keyed by courseFormat', async () => {
      const fakeAdvancedWriter = vi.fn().mockResolvedValue({ checkpointId: 'cp-advanced-fake-1', created: true })
      const deps = makeAdvancedDeps({ writePreSettlementCheckpoint: fakeAdvancedWriter })

      await processHouseholdRoundBatch(deps, {
        lessonRunId: 'run-1',
        expectedRoundIndex: 1,
        forceUnsubmitted: false,
        actorUid: 'teacher-1',
        idempotencyKey: 'key-1',
        nowMillis: 1000,
      })

      expect(fakeAdvancedWriter).toHaveBeenCalledWith(expect.objectContaining({
        courseFormat: 'ROLE_VARIANT',
        householdIds: ['hh-a', 'hh-b'],
        kind: 'PRE_SETTLEMENT',
        // Task 7: threaded from the control doc read earlier in this same
        // call, never trusting a client-supplied value (same discipline as
        // the assignmentRevision test above for createOrReplayOperationWithControlLock).
        assignmentRevision: 7,
      }))
    })

    it('passes assignmentRevision: null for COMMON_CONDITIONS (no control document exists to read one from)', async () => {
      const fakeWriter = vi.fn().mockResolvedValue({ checkpointId: 'cp-common-1', created: true })
      const deps = makeDeps({ writePreSettlementCheckpoint: fakeWriter })

      await processHouseholdRoundBatch(deps, {
        lessonRunId: 'run-1',
        expectedRoundIndex: 1,
        forceUnsubmitted: false,
        actorUid: 'teacher-1',
        idempotencyKey: 'key-1',
        nowMillis: 1000,
      })

      expect(fakeWriter).toHaveBeenCalledWith(expect.objectContaining({
        courseFormat: 'COMMON_CONDITIONS',
        assignmentRevision: null,
      }))
    })
  })
})

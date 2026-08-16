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

  /**
   * Important I2 (whole-branch review): replaying the SAME idempotencyKey
   * against an operation that already has at least one SUCCEEDED item must
   * RESUME settlement, not CANCEL. Before this fix, `processHouseholdRoundBatch`'s
   * preflight loop unconditionally treated "household's roundIndex !==
   * expectedRoundIndex" as a hard failure — but a household this SAME
   * operation already settled in a prior attempt is EXPECTED to now be one
   * round ahead. Hitting that on a replay's preflight pass cancelled the
   * whole operation (advanced formats: CANCELLED is terminal, never
   * retryable), releasing the control-document lock at the UN-ADVANCED
   * round and permanently splitting the class (some households ahead, some
   * behind) — every fresh bulk attempt would then fail preflight the same
   * way forever.
   */
  describe('processHouseholdRoundBatch idempotent replay resumes instead of cancelling (Important I2)', () => {
    const targets: HouseholdBulkTarget[] = [
      { householdId: 'hh-a', teamId: 'team-a', profileId: 'profile-a' },
      { householdId: 'hh-b', teamId: 'team-b', profileId: 'profile-b' },
      { householdId: 'hh-c', teamId: 'team-c', profileId: 'profile-c' },
    ]

    const control: HouseholdRuntimeControl = {
      courseFormat: 'ROLE_VARIANT',
      assignmentRevision: 9,
      synchronizedRoundIndex: 1,
      roundStatus: 'OPEN',
      activeOperationId: null,
      updatedAtServerMillis: 500,
    }

    it('resuming: household 1 SUCCEEDED, household 2 FAILED — resubmitting the SAME idempotencyKey does not cancel, does not re-settle household 1, and drives the operation to COMPLETED', async () => {
      const householdStates: Record<string, HouseholdState> = {
        'hh-a': makeBaseHousehold('hh-a', 1),
        'hh-b': makeBaseHousehold('hh-b', 1),
        'hh-c': makeBaseHousehold('hh-c', 1),
      }
      const decisions: Record<string, boolean> = { 'hh-a': true, 'hh-b': true, 'hh-c': true }

      let operation: HouseholdBulkSettlementOperation = {
        operationId: 'op-replay-1',
        lessonRunId: 'run-1',
        actorUid: 'teacher-1',
        expectedRoundIndex: 1,
        restoreGeneration: 0,
        assignmentRevision: 9,
        forceUnsubmitted: false,
        status: 'PENDING',
        preSettlementCheckpointId: null,
        requestDigest: 'digest-replay-1',
        attempt: 0,
        leaseExpiresAtServerMillis: null,
        lastHeartbeatAtServerMillis: null,
        households: {
          'hh-a': { status: 'PENDING', teamId: 'team-a', profileId: 'profile-a' },
          'hh-b': { status: 'PENDING', teamId: 'team-b', profileId: 'profile-b' },
          'hh-c': { status: 'PENDING', teamId: 'team-c', profileId: 'profile-c' },
        },
        createdAtServerMillis: 1000,
        updatedAtServerMillis: 1000,
      }

      // processRoundFn fails for hh-b on its FIRST call only (simulating
      // attempt 1's transient settlement error), then succeeds on any later
      // call (simulating that a genuine retry would clear it).
      let hhBAttempts = 0
      let hhASettleCalls = 0

      // Idempotent, unlike `makeDeps`'s helper (which unconditionally resets
      // `households` to PENDING on every call): the real
      // `createOrReplayBulkSettlementOperationWithControlLock` returns the
      // SAME operation object — with whatever item statuses a prior attempt
      // left behind — when replayed under the same idempotencyKey. This
      // fake mirrors that by simply always returning the current `operation`
      // closure variable, never resetting it.
      const createOrReplayOperationWithControlLock = vi.fn().mockImplementation(async () => operation)

      const deps: BulkSettlementDeps = {
        readLessonRun: vi.fn().mockResolvedValue({
          status: 'RUNNING', subject: 'HOME_ECONOMICS', courseFormat: 'ROLE_VARIANT', restoreGeneration: 0,
        }),
        readRuntimeControl: vi.fn().mockResolvedValue(control),
        listTargets: vi.fn().mockResolvedValue(targets),
        createOrReplayOperation: vi.fn(),
        createOrReplayOperationWithControlLock,
        acquireLease: vi.fn().mockImplementation(async () => {
          operation = { ...operation, status: 'RUNNING', attempt: operation.attempt + 1, leaseExpiresAtServerMillis: Date.now() + 60000 }
          return operation
        }),
        heartbeatLease: vi.fn().mockImplementation(async () => operation),
        ensureHousehold: vi.fn().mockImplementation(async (_runId, target) => householdStates[target.householdId]),
        readHouseholdState: vi.fn().mockImplementation(async (_runId, householdId) => householdStates[householdId]),
        readHouseholdDecision: vi.fn().mockImplementation(async (_runId, householdId, round) => {
          if (!decisions[householdId]) return null
          return { decisionId: `dec-${householdId}-${round}` }
        }),
        writePreSettlementCheckpoint: vi.fn().mockResolvedValue({ checkpointId: 'cp-replay-1', created: true }),
        setOperationCheckpointId: vi.fn().mockImplementation(async (_opId, cpId) => {
          operation = { ...operation, preSettlementCheckpointId: cpId }
          return operation
        }),
        processRoundFn: vi.fn().mockImplementation(async (input): Promise<ProcessRoundExecutionResult> => {
          if (input.householdId === 'hh-a') hhASettleCalls += 1
          if (input.householdId === 'hh-b') {
            hhBAttempts += 1
            if (hhBAttempts === 1) throw new Error('transient settlement error')
          }
          const current = householdStates[input.householdId]
          householdStates[input.householdId] = { ...current, roundIndex: current.roundIndex + 1 }
          return {
            status: 'COMMITTED',
            settlement: {
              newHouseholdState: householdStates[input.householdId],
              occurredEventIds: [], incomeYen: 100, expensesYen: 50, netCashFlowYen: 50,
              shortfallYen: 0, insuranceBenefitsYen: 0, shortfallOptionsConsidered: [],
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
                profileId: prior?.profileId ?? 'profile-a',
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
        // The "single unresolved operation per lessonRun" guard is
        // orthogonal to what I2 tests (both calls below use the SAME
        // idempotencyKey, so the real implementation would see its own
        // operation as the unresolved one and let it through anyway) —
        // stubbed to null to keep this test focused on the preflight/replay
        // behavior itself.
        findUnresolvedOperation: vi.fn().mockResolvedValue(null),
      }

      // ---- Attempt 1 (idempotencyKey "replay-key-1"): hh-a settles
      // successfully, hh-b fails transiently. `executeBulkItems` has no
      // early-exit on a mid-loop item failure, so hh-c is also attempted
      // (and succeeds) within this SAME call — the operation still ends
      // FAILED overall (not every item SUCCEEDED). Note this is the
      // MINIMAL reproduction of the bug: the preflight loop's false "round
      // mismatch" is triggered by hh-a's SUCCEEDED status ALONE on the next
      // replay, regardless of whether hh-c was also attempted in attempt 1
      // — so this test does not need to separately force a "hh-c never
      // attempted" crash to exercise the exact bug described.
      const firstResult = await processHouseholdRoundBatch(deps, {
        lessonRunId: 'run-1', expectedRoundIndex: 1, forceUnsubmitted: false,
        actorUid: 'teacher-1', idempotencyKey: 'replay-key-1', nowMillis: 1000,
      })
      expect(firstResult.status).toBe('FAILED')
      expect(operation.households['hh-a'].status).toBe('SUCCEEDED')
      expect(operation.households['hh-b'].status).toBe('FAILED')
      expect(hhASettleCalls).toBe(1)

      // ---- Attempt 2: the SAME idempotencyKey is resubmitted (a client
      // retry-by-resubmission, NOT the dedicated retryHouseholdRoundBatch
      // Callable). Before the I2 fix, the preflight loop would see hh-a's
      // now-advanced roundIndex (2, vs expectedRoundIndex 1), treat it as a
      // round mismatch, and CANCEL the whole operation — releasing the
      // control lock at the un-advanced round and leaving hh-b/hh-c
      // permanently stuck (no retry path, since CANCELLED is terminal).
      const secondResult = await processHouseholdRoundBatch(deps, {
        lessonRunId: 'run-1', expectedRoundIndex: 1, forceUnsubmitted: false,
        actorUid: 'teacher-1', idempotencyKey: 'replay-key-1', nowMillis: 2000,
      })

      expect(deps.cancelOperation).not.toHaveBeenCalled()
      expect(secondResult.status).not.toBe('CANCELLED')
      // This implementation resumes settlement DIRECTLY within the replay
      // call itself (the preflight loop simply skips the already-SUCCEEDED
      // item and lets `executeBulkItems` retry the rest) — it does not
      // require a separate call to the dedicated retry Callable.
      expect(secondResult.status).toBe('COMPLETED')
      expect(operation.households['hh-b'].status).toBe('SUCCEEDED')
      expect(operation.households['hh-c'].status).toBe('SUCCEEDED')
      // hh-a was never re-settled — still exactly the one call from attempt 1.
      expect(hhASettleCalls).toBe(1)
    })
  })
})

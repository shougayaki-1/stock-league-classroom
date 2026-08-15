import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { processRound, type ProcessRoundDeps } from './processRound'
import { settleRound, type SettleRoundResult } from './engine/settleRound'
import type { HouseholdState, StoredHouseholdState } from '../lessonRuns/households/repository'

/**
 * These tests exercise the pure `processRound` orchestration against fully
 * mocked deps — the Admin SDK wiring (`processRoundDepsWithAdminSdk`) is a
 * thin composition exercised indirectly via `onCall.test.ts`'s Callable
 * tests.
 */
describe('processRound', () => {
  const household: HouseholdState = {
    householdId: 'case-b', lessonRunId: 'run-1', teamId: 'team-a', profileId: 'case-b', cashYen: 500000,
    assetHoldingsYen: {}, activeInsuranceContracts: {}, activeLiabilities: {},
    lifeStage: 'CHILD_REARING', roundIndex: 2, goalDelayedRounds: 0, updatedAtServerMillis: 0,
  }
  const profile = {
    householdId: 'case-b', age: 32, householdIncomeYen: 6000000,
    annualLivingExpensesYen: 3000000, cashSavingsYen: 500000,
    family: '配偶者・子2人', housing: '賃貸マンション', lifeGoal: '住宅購入と教育資金',
    lifeStage: 'CHILD_REARING' as const, eventProbabilityOverrides: {}, internalRiskFactors: {},
  }
  const homeEconomics = {
    households: [profile], assets: [], insuranceProducts: [], lifeEvents: [], liabilities: [],
    publicSupportPrograms: [], roundYears: 5 as const, courseFormat: 'COMMON_CONDITIONS' as const,
    taxAndSocialInsuranceModelVersion: 1,
    economicFactors: { inflationPercent: 0, interestRatePercent: 1, marketReturnPercent: 0 },
    borrowingAllowed: false, goalPackage: 'OVERALL_BALANCE' as const,
    evaluationWeights: {
      lifeGoalAchievement: 1, emergencyFundAdequacy: 0, stability: 0, diversification: 0, borrowingBurden: 0, reflection: 0,
    },
  }
  const settleResult: SettleRoundResult = {
    newHouseholdState: { ...household, roundIndex: 3, cashYen: 600000 },
    occurredEventIds: [], incomeYen: 4800000, expensesYen: 3000000,
    netCashFlowYen: 1800000, shortfallYen: 0, insuranceBenefitsYen: 0,
    shortfallOptionsConsidered: [],
  }
  // A submitted decision — used as the default so these orchestration tests
  // exercise the normal path (household HAS submitted). The submission-gate
  // itself (decision === null, forceSettle unset/true) is covered by the
  // dedicated tests below.
  const submittedDecision = {
    lessonRunId: 'run-1', householdId: 'case-b', roundIndex: 2,
    assetAllocationChangesYen: {}, insurancePurchaseIds: [], insuranceCancelIds: [],
    shortfallResolutionType: null, publicSupportApplicationIds: [], idempotencyKey: 'key-1',
  }

  const makeDeps = (overrides: Partial<ProcessRoundDeps> = {}): ProcessRoundDeps => ({
    readLessonRunConfig: vi.fn().mockResolvedValue({
      orgId: 'org-1', randomSeed: 'seed-x', restoreGeneration: 0, homeEconomics,
    }),
    readHouseholdState: vi.fn().mockResolvedValue(household),
    readHouseholdDecision: vi.fn().mockResolvedValue(submittedDecision),
    settleRoundFn: vi.fn().mockReturnValue(settleResult),
    commitRoundSettlement: vi.fn().mockResolvedValue({ status: 'COMMITTED' }),
    publishRealtimeState: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  })

  it('throws when the HouseholdState does not exist', async () => {
    const deps = makeDeps({ readHouseholdState: vi.fn().mockResolvedValue(null) })
    await expect(processRound(deps, { lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a' }))
      .rejects.toThrow('HouseholdState not found')
    expect(deps.settleRoundFn).not.toHaveBeenCalled()
  })

  it('throws when the household has no matching profile in the template snapshot', async () => {
    const deps = makeDeps({
      readLessonRunConfig: vi.fn().mockResolvedValue({
        orgId: 'org-1', randomSeed: 'seed-x', restoreGeneration: 0, homeEconomics: { ...homeEconomics, households: [] },
      }),
    })
    await expect(processRound(deps, { lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a' }))
      .rejects.toThrow('HouseholdProfile not found in template snapshot')
    expect(deps.settleRoundFn).not.toHaveBeenCalled()
  })

  it('reads the decision for the household\'s OWN current roundIndex, not a client-supplied one', async () => {
    const deps = makeDeps()
    await processRound(deps, { lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a' })
    expect(deps.readHouseholdDecision).toHaveBeenCalledWith('run-1', 'case-b', 2)
  })

  it('forwards assetCatalog (Step 4 fix) from the template snapshot into settleRoundFn', async () => {
    const catalog = [{ assetType: 'DOMESTIC_STOCK' as const, valueYen: 0, expectedReturnPercent: 5, volatilityPercent: 1 }]
    const deps = makeDeps({
      readLessonRunConfig: vi.fn().mockResolvedValue({
        orgId: 'org-1', randomSeed: 'seed-x', restoreGeneration: 0, homeEconomics: { ...homeEconomics, assets: catalog },
      }),
    })
    await processRound(deps, { lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a' })
    expect(deps.settleRoundFn).toHaveBeenCalledWith(expect.objectContaining({ assetCatalog: catalog }))
  })

  it('calls settleRoundFn with the assembled household/profile/decision/config, then commits the result', async () => {
    const deps = makeDeps()
    const result = await processRound(deps, { lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a' })
    expect(result).toEqual({ status: 'COMMITTED', settlement: settleResult })
    expect(deps.settleRoundFn).toHaveBeenCalledWith(expect.objectContaining({
      household, profile, decision: submittedDecision, randomSeed: 'seed-x', restoreGeneration: 0,
      taxModelVersion: 1, roundYears: 5, borrowingAllowed: false,
    }))
    expect(deps.commitRoundSettlement).toHaveBeenCalledWith({
      lessonRunId: 'run-1', householdId: 'case-b', orgId: 'org-1',
      expectedPriorRoundIndex: 2, result: settleResult, actorId: 'teacher-a',
      forcedSettlement: false,
    })
  })

  /**
   * Task 4 — `household.profileId` (not the runtime `householdId`) is the
   * unambiguous key used to resolve the profile. This proves the resolution
   * still works correctly even when the runtime `householdId` (an opaque
   * per-team-slot id, `runtimeHouseholdId()`) is completely different from
   * the profileId it's running — the exact case the 3 advanced formats
   * introduce and the old array-length/courseFormat heuristic could not
   * handle unambiguously.
   */
  it('resolves the profile by household.profileId, independent of what the runtime householdId is', async () => {
    const assignedHousehold: HouseholdState = { ...household, householdId: 'household-runtime-1', profileId: 'case-b' }
    const deps = makeDeps({
      readHouseholdState: vi.fn().mockResolvedValue(assignedHousehold),
      readHouseholdDecision: vi.fn().mockResolvedValue({ ...submittedDecision, householdId: 'household-runtime-1' }),
    })
    const result = await processRound(deps, { lessonRunId: 'run-1', householdId: 'household-runtime-1', actorId: 'teacher-a' })
    expect(result).toEqual({ status: 'COMMITTED', settlement: settleResult })
    expect(deps.settleRoundFn).toHaveBeenCalledWith(expect.objectContaining({ profile }))
  })

  /**
   * Task 4 — legacy documents written before `profileId` existed have no
   * such field on the stored data. Under COMMON_CONDITIONS with exactly one
   * authored profile, `resolveStoredHouseholdState` (called internally by
   * `processRound`) infers it from that sole profile, so settlement still
   * succeeds rather than throwing 'HouseholdProfile not found'.
   */
  it('resolves the sole profile for a legacy COMMON_CONDITIONS household document with no stored profileId', async () => {
    const legacyStored = { ...household, householdId: 'team-a' } as StoredHouseholdState
    delete (legacyStored as { profileId?: string }).profileId
    const deps = makeDeps({
      readHouseholdState: vi.fn().mockResolvedValue(legacyStored),
      readHouseholdDecision: vi.fn().mockResolvedValue({ ...submittedDecision, householdId: 'team-a' }),
    })
    const result = await processRound(deps, { lessonRunId: 'run-1', householdId: 'team-a', actorId: 'teacher-a' })
    expect(result).toEqual({ status: 'COMMITTED', settlement: settleResult })
    expect(deps.settleRoundFn).toHaveBeenCalledWith(expect.objectContaining({ profile }))
  })

  /**
   * Task 4 — fail closed. There is no safe positional inference for a
   * missing `profileId` under an advanced course format (ROLE_VARIANT/
   * STAGE_SPLIT/MULTI_PERSON_PER_TEAM): a household with no recorded
   * profile identity is a data-integrity problem, not something to guess
   * at from array position or courseFormat alone (the exact fragility the
   * old heuristic had).
   */
  it('throws when profileId is missing on the stored household under an advanced course format', async () => {
    const advancedHomeEconomics = { ...homeEconomics, courseFormat: 'ROLE_VARIANT' as const }
    const legacyStored = { ...household, householdId: 'household-runtime-1' } as StoredHouseholdState
    delete (legacyStored as { profileId?: string }).profileId
    const deps = makeDeps({
      readLessonRunConfig: vi.fn().mockResolvedValue({
        orgId: 'org-1', randomSeed: 'seed-x', restoreGeneration: 0, homeEconomics: advancedHomeEconomics,
      }),
      readHouseholdState: vi.fn().mockResolvedValue(legacyStored),
      readHouseholdDecision: vi.fn().mockResolvedValue({ ...submittedDecision, householdId: 'household-runtime-1' }),
    })
    await expect(processRound(deps, { lessonRunId: 'run-1', householdId: 'household-runtime-1', actorId: 'teacher-a' }))
      .rejects.toThrow(/profileId/)
    expect(deps.settleRoundFn).not.toHaveBeenCalled()
  })

  /**
   * Task 4 — STAGE_SPLIT assigns a household to a profile whose authored
   * `lifeStage` reflects that stage, but the household's OWN `lifeStage`
   * (the source of truth for settlement, see `settleRound.ts`) must never
   * be silently overwritten by the profile's `lifeStage` during settlement.
   * This runs the REAL `settleRound` engine (not a mock) precisely so it
   * proves actual settlement behavior, not just that the right arguments
   * were passed to a stub.
   */
  it('keeps household.lifeStage fixed after settlement even when it differs from the STAGE_SPLIT profile\'s lifeStage', async () => {
    const stageSplitProfile = { ...profile, lifeStage: 'RETIRED' as const }
    const stageSplitHomeEconomics = {
      ...homeEconomics, courseFormat: 'STAGE_SPLIT' as const, households: [stageSplitProfile],
    }
    const stageHousehold: HouseholdState = { ...household, lifeStage: 'CHILD_REARING' }
    const deps = makeDeps({
      readLessonRunConfig: vi.fn().mockResolvedValue({
        orgId: 'org-1', randomSeed: 'seed-x', restoreGeneration: 0, homeEconomics: stageSplitHomeEconomics,
      }),
      readHouseholdState: vi.fn().mockResolvedValue(stageHousehold),
      readHouseholdDecision: vi.fn().mockResolvedValue(submittedDecision),
      settleRoundFn: settleRound,
    })
    const result = await processRound(deps, { lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a' })
    expect(result.status).toBe('COMMITTED')
    if (result.status !== 'COMMITTED') throw new Error('unreachable')
    expect(result.settlement.newHouseholdState.lifeStage).toBe('CHILD_REARING')
  })

  /**
   * Task 15 — `publishRealtimeState` must actually be invoked (not left
   * unwired the way Phase C's RTDB broadcast was until its final
   * whole-branch review), with everything the Admin SDK implementation
   * needs to build the three RTDB writes, and only AFTER
   * `commitRoundSettlement` has committed (so the broadcast reflects the
   * just-written state, not a stale pre-settlement one).
   */
  it('calls publishRealtimeState with orgId/homeEconomics/profile/decision/result, after commitRoundSettlement', async () => {
    const deps = makeDeps()
    const callOrder: string[] = []
    ;(deps.commitRoundSettlement as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push('commit')
      return { status: 'COMMITTED' }
    })
    ;(deps.publishRealtimeState as ReturnType<typeof vi.fn>).mockImplementation(async () => { callOrder.push('publish') })

    await processRound(deps, { lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a' })

    expect(deps.publishRealtimeState).toHaveBeenCalledWith({
      lessonRunId: 'run-1', orgId: 'org-1', homeEconomics, profile, decision: submittedDecision, result: settleResult,
    })
    expect(callOrder).toEqual(['commit', 'publish'])
  })

  /**
   * Task 11 review round 2 — brief §Step 6: `processRoundCallable` must not
   * let a teacher settle a household that hasn't submitted a decision for
   * the round yet, distinct from `settleRound`'s own `decision === null` →
   * `REDUCE_EXPENSES` auto-fallback (§13.13), which is for a shortfall only
   * discovered mid-settlement despite a decision existing (or an explicit
   * force). See `processRound.ts`'s `ProcessRoundInput.forceSettle` doc
   * comment for the full reasoning.
   */
  describe('submission gate (Task 11 review round 2)', () => {
    it('rejects settlement when no decision has been submitted for this round and forceSettle is not set', async () => {
      const deps = makeDeps({ readHouseholdDecision: vi.fn().mockResolvedValue(null) })
      await expect(processRound(deps, { lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a' }))
        .rejects.toThrow('HouseholdDecision not submitted for this round')
      expect(deps.settleRoundFn).not.toHaveBeenCalled()
      expect(deps.commitRoundSettlement).not.toHaveBeenCalled()
    })

    it('allows settlement with no submitted decision when forceSettle is true and records forcedSettlement=true', async () => {
      const deps = makeDeps({ readHouseholdDecision: vi.fn().mockResolvedValue(null) })
      const result = await processRound(deps, {
        lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a', forceSettle: true,
      })
      expect(result).toEqual({ status: 'COMMITTED', settlement: settleResult })
      expect(deps.settleRoundFn).toHaveBeenCalledWith(expect.objectContaining({ decision: null }))
      expect(deps.commitRoundSettlement).toHaveBeenCalledWith(expect.objectContaining({
        forcedSettlement: true,
      }))
    })

    it('records forcedSettlement=false when decision was submitted', async () => {
      const deps = makeDeps()
      const result = await processRound(deps, {
        lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a', forceSettle: false,
      })
      expect(result).toEqual({ status: 'COMMITTED', settlement: settleResult })
      expect(deps.commitRoundSettlement).toHaveBeenCalledWith(expect.objectContaining({
        forcedSettlement: false,
      }))
    })
  })

  describe('duplicate settlement safety', () => {
    it('returns ALREADY_SETTLED and does not publish realtime state when commitRoundSettlement reports ALREADY_SETTLED', async () => {
      const currentHouseholdState: HouseholdState = { ...household, roundIndex: 3 }
      const deps = makeDeps({
        commitRoundSettlement: vi.fn().mockResolvedValue({
          status: 'ALREADY_SETTLED',
          householdState: currentHouseholdState,
        }),
      })

      const result = await processRound(deps, {
        lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a',
      })

      expect(result).toEqual({
        status: 'ALREADY_SETTLED',
        householdState: currentHouseholdState,
      })
      expect(deps.publishRealtimeState).not.toHaveBeenCalled()
    })
  })
})

// -----------------------------------------------------------------------------
// Exercises `readLessonRunConfigWithAdminSdk` directly (Important I3, final
// whole-branch review) — the Admin SDK wiring has no injected dependency
// seam (it calls getFirestore() directly, matching every other
// *WithAdminSdk function in this codebase), so a module-level
// vi.mock('firebase-admin/firestore', ...) is the established way to test
// it without a real emulator, same precedent as
// market/processBatch.publishRealtimeState.test.ts.
// -----------------------------------------------------------------------------
const firestoreDocs = new Map<string, Record<string, unknown>>()

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => ({
      get: async () => ({ exists: firestoreDocs.has(path), data: () => firestoreDocs.get(path) }),
    }),
  }),
}))

beforeEach(() => {
  firestoreDocs.clear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('readLessonRunConfigWithAdminSdk (Important I3)', () => {
  const homeEconomicsSnapshot = {
    households: [], assets: [], insuranceProducts: [], lifeEvents: [], liabilities: [],
    publicSupportPrograms: [], roundYears: 5, courseFormat: 'COMMON_CONDITIONS',
    taxAndSocialInsuranceModelVersion: 1,
    economicFactors: { inflationPercent: 0, interestRatePercent: 1, marketReturnPercent: 0 },
    borrowingAllowed: false, goalPackage: 'OVERALL_BALANCE',
    evaluationWeights: {
      lifeGoalAchievement: 1, emergencyFundAdequacy: 0, stability: 0, diversification: 0, borrowingBurden: 0, reflection: 0,
    },
  }

  /**
   * The core I3 regression test: a LessonRun document missing `orgId`
   * entirely must THROW during settlement, not silently coerce to `''` and
   * proceed to write an unreadable RTDB node downstream.
   */
  it('throws when the LessonRun document has no orgId at all', async () => {
    firestoreDocs.set('lessonRuns/run-1', {
      randomSeed: 'seed-x', restoreGeneration: 0, templateSnapshot: { homeEconomics: homeEconomicsSnapshot },
    })
    const { readLessonRunConfigWithAdminSdk } = await import('./processRound')
    await expect(readLessonRunConfigWithAdminSdk('run-1'))
      .rejects.toThrow('LessonRun is missing orgId — cannot settle round safely.')
  })

  it('throws when orgId is an empty string', async () => {
    firestoreDocs.set('lessonRuns/run-1', {
      orgId: '', randomSeed: 'seed-x', restoreGeneration: 0, templateSnapshot: { homeEconomics: homeEconomicsSnapshot },
    })
    const { readLessonRunConfigWithAdminSdk } = await import('./processRound')
    await expect(readLessonRunConfigWithAdminSdk('run-1'))
      .rejects.toThrow('LessonRun is missing orgId — cannot settle round safely.')
  })

  it('succeeds and returns the real orgId when present', async () => {
    firestoreDocs.set('lessonRuns/run-1', {
      orgId: 'org-real', randomSeed: 'seed-x', restoreGeneration: 0, templateSnapshot: { homeEconomics: homeEconomicsSnapshot },
    })
    const { readLessonRunConfigWithAdminSdk } = await import('./processRound')
    const config = await readLessonRunConfigWithAdminSdk('run-1')
    expect(config.orgId).toBe('org-real')
  })
})

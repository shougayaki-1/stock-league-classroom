import { describe, expect, it, vi } from 'vitest'
import { processRound, type ProcessRoundDeps } from './processRound'
import type { SettleRoundResult } from './engine/settleRound'
import type { HouseholdState } from '../lessonRuns/households/repository'

/**
 * These tests exercise the pure `processRound` orchestration against fully
 * mocked deps — the Admin SDK wiring (`processRoundDepsWithAdminSdk`) is a
 * thin composition exercised indirectly via `onCall.test.ts`'s Callable
 * tests.
 */
describe('processRound', () => {
  const household: HouseholdState = {
    householdId: 'case-b', lessonRunId: 'run-1', teamId: 'team-a', cashYen: 500000,
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
  }

  const makeDeps = (overrides: Partial<ProcessRoundDeps> = {}): ProcessRoundDeps => ({
    readLessonRunConfig: vi.fn().mockResolvedValue({
      orgId: 'org-1', randomSeed: 'seed-x', restoreGeneration: 0, homeEconomics,
    }),
    readHouseholdState: vi.fn().mockResolvedValue(household),
    readHouseholdDecision: vi.fn().mockResolvedValue(null),
    settleRoundFn: vi.fn().mockReturnValue(settleResult),
    commitRoundSettlement: vi.fn().mockResolvedValue(undefined),
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
    expect(result).toBe(settleResult)
    expect(deps.settleRoundFn).toHaveBeenCalledWith(expect.objectContaining({
      household, profile, decision: null, randomSeed: 'seed-x', restoreGeneration: 0,
      taxModelVersion: 1, roundYears: 5, borrowingAllowed: false,
    }))
    expect(deps.commitRoundSettlement).toHaveBeenCalledWith({
      lessonRunId: 'run-1', householdId: 'case-b', orgId: 'org-1',
      expectedPriorRoundIndex: 2, result: settleResult, actorId: 'teacher-a',
    })
  })
})

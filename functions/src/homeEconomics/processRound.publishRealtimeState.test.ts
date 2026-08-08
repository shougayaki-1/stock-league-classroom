import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeEconomicsContent, HouseholdProfile } from '@stock-league/household-authoring-content'
import type { SettleRoundResult } from './engine/settleRound'

// -----------------------------------------------------------------------------
// Exercises `publishRealtimeStateWithAdminSdk` (processRound.ts) directly —
// the Task 15 RTDB broadcast that Task 11 deliberately left unwired. Follows
// the precedent in market/processBatch.publishRealtimeState.test.ts of
// module-level vi.mock('firebase-admin/database', ...): this function calls
// getDatabase() directly (no injected dependency seam), so the module-level
// mock is the established way to test it without a real emulator. Unlike
// processBatch's equivalent, this function has NO Firestore reads of its
// own — every input it needs is passed in by `processRound` (see
// ProcessRoundDeps['publishRealtimeState']'s doc comment) — so only
// firebase-admin/database needs mocking here.
// -----------------------------------------------------------------------------

const rtdbUpdates: Array<{ path: string; data: Record<string, unknown> }> = []

vi.mock('firebase-admin/database', () => ({
  getDatabase: () => ({
    ref: (path: string) => ({
      update: async (data: Record<string, unknown>) => { rtdbUpdates.push({ path, data }) },
    }),
  }),
}))

beforeEach(() => {
  rtdbUpdates.length = 0
})

afterEach(() => {
  vi.clearAllMocks()
})

const profile: HouseholdProfile = {
  householdId: 'case-b', age: 32, householdIncomeYen: 6000000,
  annualLivingExpensesYen: 3000000, cashSavingsYen: 500000,
  family: '配偶者・子2人', housing: '賃貸マンション', lifeGoal: '住宅購入と教育資金',
  lifeStage: 'CHILD_REARING', eventProbabilityOverrides: {},
  internalRiskFactors: { mortalityRisk: 0.01 },
}

const homeEconomics: HomeEconomicsContent = {
  households: [profile], assets: [], insuranceProducts: [
    {
      id: 'ins-1', productName: '生命保険', premiumYenPerYear: 50000, coveredRisk: '死亡',
      benefitDescription: '死亡時に給付', benefitAmountYen: 1000000, contractYears: 10,
      coveredEventIds: [], internalClaimProbability: 0.02,
    },
  ],
  lifeEvents: [], liabilities: [],
  publicSupportPrograms: [], roundYears: 5, courseFormat: 'COMMON_CONDITIONS',
  taxAndSocialInsuranceModelVersion: 1,
  economicFactors: { inflationPercent: 1, interestRatePercent: 2, marketReturnPercent: 3 },
  borrowingAllowed: false, goalPackage: 'EMERGENCY_FUND',
  evaluationWeights: {
    lifeGoalAchievement: 1, emergencyFundAdequacy: 0, stability: 0, diversification: 0, borrowingBurden: 0, reflection: 0,
  },
}

const result: SettleRoundResult = {
  newHouseholdState: {
    householdId: 'case-b', lessonRunId: 'run-1', teamId: 'team-a', cashYen: 600000,
    assetHoldingsYen: { DOMESTIC_STOCK: 100000 }, activeInsuranceContracts: { 'ins-1': 9 },
    activeLiabilities: {}, lifeStage: 'CHILD_REARING', roundIndex: 3, goalDelayedRounds: 0,
    updatedAtServerMillis: 1000,
  },
  occurredEventIds: [], incomeYen: 4800000, expensesYen: 3000000,
  netCashFlowYen: 1800000, shortfallYen: 0, insuranceBenefitsYen: 0,
  // Surplus round — settleRound never considers any shortfall options when
  // shortfallYen === 0 (see shortfallOptions.ts's `buildShortfallOptions`
  // JSDoc: it always includes REDUCE_EXPENSES/DELAY_GOAL, so the array is
  // NEVER empty when actually called — settleRound therefore only calls it
  // when shortfallYen > 0, leaving this [] on a surplus round).
  shortfallOptionsConsidered: [],
}

describe('publishRealtimeStateWithAdminSdk', () => {
  it('writes orgId on every one of the three RTDB nodes (Phase C Task 20 postmortem: a write missing orgId is permanently unreadable)', async () => {
    const { publishRealtimeStateWithAdminSdk } = await import('./processRound')
    await publishRealtimeStateWithAdminSdk({ lessonRunId: 'run-1', orgId: 'org-1', homeEconomics, profile, decision: null, result })

    const publicUpdate = rtdbUpdates.find((u) => u.path === 'lessonRunPublic/run-1')
    const privateUpdate = rtdbUpdates.find((u) => u.path === 'lessonRunPrivate/run-1')
    const teamUpdate = rtdbUpdates.find((u) => u.path === 'lessonRunTeamState/run-1/team-a')
    expect(publicUpdate?.data.orgId).toBe('org-1')
    expect(privateUpdate?.data.orgId).toBe('org-1')
    expect(teamUpdate?.data.orgId).toBe('org-1')
  })

  it('partially updates lessonRunPublic with only economicFactors (+ orgId), never a household field', async () => {
    const { publishRealtimeStateWithAdminSdk } = await import('./processRound')
    await publishRealtimeStateWithAdminSdk({ lessonRunId: 'run-1', orgId: 'org-1', homeEconomics, profile, decision: null, result })

    const publicUpdate = rtdbUpdates.find((u) => u.path === 'lessonRunPublic/run-1')
    expect(publicUpdate).toBeDefined()
    expect(Object.keys(publicUpdate!.data).sort()).toEqual(['economicFactors', 'orgId'])
    expect(publicUpdate!.data.economicFactors).toEqual({ inflationPercent: 1, interestRatePercent: 2, marketReturnPercent: 3 })
  })

  it('writes lessonRunPrivate with internalRiskFactors and internalClaimProbability, keyed by householdId — never mirrored elsewhere', async () => {
    const { publishRealtimeStateWithAdminSdk } = await import('./processRound')
    await publishRealtimeStateWithAdminSdk({ lessonRunId: 'run-1', orgId: 'org-1', homeEconomics, profile, decision: null, result })

    const privateUpdate = rtdbUpdates.find((u) => u.path === 'lessonRunPrivate/run-1')
    expect(privateUpdate).toBeDefined()
    const log = privateUpdate!.data['householdComputationLog/case-b'] as Record<string, unknown>
    expect(log.internalRiskFactors).toEqual({ mortalityRisk: 0.01 })
    expect(log.internalClaimProbability).toEqual({ 'ins-1': 0.02 })
    expect(log.shortfallYen).toBe(0)

    const publicUpdate = rtdbUpdates.find((u) => u.path === 'lessonRunPublic/run-1')
    const teamUpdate = rtdbUpdates.find((u) => u.path === 'lessonRunTeamState/run-1/team-a')
    expect(JSON.stringify(publicUpdate!.data)).not.toContain('internalClaimProbability')
    expect(JSON.stringify(teamUpdate!.data)).not.toContain('internalClaimProbability')
    expect(JSON.stringify(publicUpdate!.data)).not.toContain('internalRiskFactors')
    expect(JSON.stringify(teamUpdate!.data)).not.toContain('internalRiskFactors')
  })

  it('writes lessonRunTeamState with only an allow-listed household view, keyed by this household\'s own teamId', async () => {
    const { publishRealtimeStateWithAdminSdk } = await import('./processRound')
    await publishRealtimeStateWithAdminSdk({ lessonRunId: 'run-1', orgId: 'org-1', homeEconomics, profile, decision: null, result })

    const teamUpdate = rtdbUpdates.find((u) => u.path === 'lessonRunTeamState/run-1/team-a')
    expect(teamUpdate).toBeDefined()
    expect(Object.keys(teamUpdate!.data).sort()).toEqual(['household', 'orgId', 'updatedAtMillis'])
    const household = teamUpdate!.data.household as Record<string, unknown>
    expect(household.householdId).toBe('case-b')
    expect(household.isFictional).toBe(true)
    expect(household.visibleConcepts).toEqual(['EMERGENCY_FUND', 'RISK_MANAGEMENT'])
  })

  /**
   * Critical C1 (Task 15 review): `buildShortfallOptions` always includes
   * REDUCE_EXPENSES/DELAY_GOAL regardless of the shortfall amount (by
   * design — see Task 8), so the array it returns is NEVER empty when
   * actually invoked. A surplus round (shortfallYen === 0) must therefore
   * broadcast an empty `shortfallOptions` array — `settleRound` never even
   * calls `buildShortfallOptions` in that case (see settleRound.ts's
   * `if (shortfallYen > 0)` guard) — otherwise `HouseholdSummaryCard`'s
   * "資金が不足しています" prompt would show up after every single round,
   * even a surplus one.
   */
  it('broadcasts an empty shortfallOptions array on a surplus round (shortfallYen === 0) (Critical C1)', async () => {
    const { publishRealtimeStateWithAdminSdk } = await import('./processRound')
    await publishRealtimeStateWithAdminSdk({ lessonRunId: 'run-1', orgId: 'org-1', homeEconomics, profile, decision: null, result })

    const teamUpdate = rtdbUpdates.find((u) => u.path === 'lessonRunTeamState/run-1/team-a')
    const household = teamUpdate!.data.household as { shortfallOptions: Array<{ type: string }> }
    expect(household.shortfallOptions).toEqual([])
  })

  /**
   * Important I2 (Task 15 review): the broadcast must forward the SAME
   * shortfall options `settleRound` actually computed/considered
   * (`result.shortfallOptionsConsidered`) rather than independently
   * recomputing `buildShortfallOptions` from post-settlement state (which
   * previously diverged — see settleRound.ts's `SettleRoundResult.
   * shortfallOptionsConsidered` JSDoc for the two concrete divergences this
   * closes). This test constructs `shortfallOptionsConsidered` by hand to
   * simulate what a real `settleRound` shortfall round would have produced,
   * and asserts `publishRealtimeStateWithAdminSdk` forwards it unchanged.
   */
  it('forwards result.shortfallOptionsConsidered unchanged when a shortfall exists (Important I2)', async () => {
    const { publishRealtimeStateWithAdminSdk } = await import('./processRound')
    const shortfallResult: SettleRoundResult = {
      ...result,
      shortfallYen: 50000,
      shortfallOptionsConsidered: [
        { type: 'REDUCE_EXPENSES', description: '生活費を切り詰める', resolvesYen: 50000 },
        { type: 'DELAY_GOAL', description: '目標達成を先送りする', resolvesYen: 50000 },
        { type: 'SELL_ASSETS', description: '資産を売却する', resolvesYen: 50000 },
      ],
    }
    await publishRealtimeStateWithAdminSdk({
      lessonRunId: 'run-1', orgId: 'org-1', homeEconomics, profile,
      decision: {
        lessonRunId: 'run-1', householdId: 'case-b', roundIndex: 3, assetAllocationChangesYen: {},
        insurancePurchaseIds: [], insuranceCancelIds: [], shortfallResolutionType: 'REDUCE_EXPENSES',
        publicSupportApplicationIds: [], idempotencyKey: 'k',
      },
      result: shortfallResult,
    })

    const teamUpdate = rtdbUpdates.find((u) => u.path === 'lessonRunTeamState/run-1/team-a')
    const household = teamUpdate!.data.household as { shortfallOptions: Array<{ type: string }> }
    expect(household.shortfallOptions).toEqual(shortfallResult.shortfallOptionsConsidered)
    expect(household.shortfallOptions.some((o) => o.type === 'REDUCE_EXPENSES')).toBe(true)
    expect(household.shortfallOptions.some((o) => o.type === 'DELAY_GOAL')).toBe(true)
    expect(household.shortfallOptions.some((o) => o.type === 'SELL_ASSETS')).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { settleRound } from './settleRound'

const baseHousehold = {
  householdId: 'case-b', lessonRunId: 'run-1', teamId: 'team-a',
  cashYen: 500000, assetHoldingsYen: { DOMESTIC_STOCK: 1000000 },
  activeInsuranceContracts: {}, activeLiabilities: {},
  lifeStage: 'CHILD_REARING', roundIndex: 0, goalDelayedRounds: 0, updatedAtServerMillis: 0,
}
const baseProfile = {
  householdId: 'case-b', age: 32, householdIncomeYen: 6000000,
  annualLivingExpensesYen: 3000000, cashSavingsYen: 500000,
  family: '配偶者・子2人', housing: '賃貸マンション', lifeGoal: '住宅購入と教育資金',
  lifeStage: 'CHILD_REARING' as const, eventProbabilityOverrides: {}, internalRiskFactors: {},
}
const baseInput = {
  household: baseHousehold, profile: baseProfile, decision: null,
  lifeEvents: [], insuranceProducts: [], publicSupportPrograms: [], liabilityCatalog: [],
  assetCatalog: [],
  economicFactors: { inflationPercent: 0, interestRatePercent: 1, marketReturnPercent: 0 },
  taxModelVersion: 1, roundYears: 5, borrowingAllowed: false,
  randomSeed: 'seed-x', restoreGeneration: 0,
}

describe('settleRound', () => {
  it('a household with no events/mortgage/insurance nets income-tax-expenses into cash, deterministically', () => {
    const result = settleRound(baseInput)
    // grossIncome 6,000,000 → tax model v1 (20% flat, Task 3 PROVISIONAL) → net 4,800,000
    // fixedExpenses 0 (no mortgage/insurance), variableExpenses 3,000,000 (no inflation)
    // netCashFlow = 4,800,000 - 3,000,000 = 1,800,000
    expect(result.newHouseholdState.cashYen).toBe(baseHousehold.cashYen + 1800000)
    expect(result.newHouseholdState.roundIndex).toBe(1)
    expect(result.shortfallYen).toBe(0)
  })

  it('is deterministic — same inputs always produce the same asset returns', () => {
    expect(settleRound(baseInput).newHouseholdState.assetHoldingsYen).toEqual(settleRound(baseInput).newHouseholdState.assetHoldingsYen)
  })

  it('auto-resolves an unexpected shortfall with REDUCE_EXPENSES when no decision was submitted (spec §13.13: never auto-bankrupts)', () => {
    const input = {
      ...baseInput,
      household: { ...baseHousehold, cashYen: 0 },
      profile: { ...baseProfile, householdIncomeYen: 0 },
    }
    // net income 0, expenses 3,000,000 → shortfall 3,000,000 with no decision submitted
    const result = settleRound(input)
    expect(result.shortfallYen).toBe(3000000)
    expect(result.newHouseholdState.cashYen).toBeGreaterThanOrEqual(0)
  })

  it('mortgage payments count toward fixed expenses and reduce the outstanding liability (Task 5 integration)', () => {
    const input = {
      ...baseInput,
      household: {
        ...baseHousehold,
        activeLiabilities: { 'loan-1': { remainingPrincipalYen: 20000000, remainingYears: 20, annualInterestRatePercent: 0 } },
      },
      liabilityCatalog: [{ id: 'loan-1', kind: 'MORTGAGE' as const, principalYen: 20000000, remainingPrincipalYen: 20000000, annualInterestRatePercent: 0, remainingYears: 20 }],
    }
    const result = settleRound(input)
    // 0% interest, 20yr, roundYears=5: 5 * (20,000,000/20) = 5,000,000 paid over the round
    expect(result.newHouseholdState.activeLiabilities['loan-1'].remainingPrincipalYen).toBe(15000000)
    expect(result.newHouseholdState.activeLiabilities['loan-1'].remainingYears).toBe(15)
  })

  it('an insurance benefit only pays when its covered event actually fires this round (Task 6/7 integration)', () => {
    const input = {
      ...baseInput,
      household: { ...baseHousehold, activeInsuranceContracts: { 'ins-1': 10 } },
      insuranceProducts: [{
        id: 'ins-1', productName: '医療保険A', premiumYenPerYear: 60000, coveredRisk: '病気',
        benefitDescription: 'x', benefitAmountYen: 500000, contractYears: 10,
        coveredEventIds: ['illness'], internalClaimProbability: 0.5,
      }],
      lifeEvents: [{
        id: 'illness', label: '病気', disclosureMode: 'HIDDEN' as const, triggerProbability: 1,
        effectDescription: 'x', incomeEffectYen: 0, expenseEffectYen: 0, cashEffectYen: 0,
      }],
    }
    const result = settleRound(input)
    expect(result.occurredEventIds).toEqual(['illness'])
    expect(result.insuranceBenefitsYen).toBe(500000)
  })

  it('resolves expectedReturnPercent/volatilityPercent for an asset from assetCatalog by assetType, not the placeholder zero (Step 4 fix)', () => {
    const input = {
      ...baseInput,
      household: { ...baseHousehold, assetHoldingsYen: { DOMESTIC_STOCK: 1000000 } },
      assetCatalog: [
        { assetType: 'DOMESTIC_STOCK' as const, valueYen: 0, expectedReturnPercent: 10, volatilityPercent: 0 },
      ],
    }
    const result = settleRound(input)
    // expectedReturnPercent 10, volatilityPercent 0, marketReturnPercent 0 → exact +10%, no noise
    expect(result.newHouseholdState.assetHoldingsYen.DOMESTIC_STOCK).toBe(1100000)
  })

  // ---------------------------------------------------------------------
  // Fix round 1 — regression tests for the money-conservation review findings
  // ---------------------------------------------------------------------

  it('SELL_ASSETS reduces the sold asset holding, not just increases cash (Critical #1)', () => {
    const input = {
      ...baseInput,
      household: {
        ...baseHousehold,
        cashYen: 0,
        assetHoldingsYen: { DOMESTIC_STOCK: 5000000 },
      },
      profile: { ...baseProfile, householdIncomeYen: 0 },
      decision: {
        lessonRunId: 'run-1', householdId: 'case-b', roundIndex: 0,
        assetAllocationChangesYen: {},
        insurancePurchaseIds: [], insuranceCancelIds: [],
        shortfallResolutionType: 'SELL_ASSETS' as const,
        shortfallResolutionAssetType: 'DOMESTIC_STOCK',
        publicSupportApplicationIds: [], idempotencyKey: 'k1',
      },
      // no returns this round — isolate the sale effect
      assetCatalog: [{ assetType: 'DOMESTIC_STOCK' as const, valueYen: 0, expectedReturnPercent: 0, volatilityPercent: 0 }],
    }
    // net income 0, expenses 3,000,000 → shortfall 3,000,000, all liquid assets = 5,000,000 → SELL_ASSETS resolves fully at 3,000,000
    const result = settleRound(input)
    expect(result.shortfallYen).toBe(3000000)
    expect(result.newHouseholdState.assetHoldingsYen.DOMESTIC_STOCK).toBe(2000000)
    expect(result.newHouseholdState.cashYen).toBe(0)
  })

  it('asset-allocation reallocation is cash-conservative: total cash+assets is unchanged by reallocation alone (Critical #2)', () => {
    const input = {
      ...baseInput,
      household: { ...baseHousehold, cashYen: 500000, assetHoldingsYen: { DOMESTIC_STOCK: 1000000 } },
      profile: { ...baseProfile, householdIncomeYen: 0, annualLivingExpensesYen: 0 },
      decision: {
        lessonRunId: 'run-1', householdId: 'case-b', roundIndex: 0,
        assetAllocationChangesYen: { DOMESTIC_STOCK: 300000 },
        insurancePurchaseIds: [], insuranceCancelIds: [],
        shortfallResolutionType: null, shortfallResolutionAssetType: undefined,
        publicSupportApplicationIds: [], idempotencyKey: 'k2',
      },
      // no returns this round — isolate the reallocation effect
      assetCatalog: [{ assetType: 'DOMESTIC_STOCK' as const, valueYen: 0, expectedReturnPercent: 0, volatilityPercent: 0 }],
    }
    // net income 0, expenses 0 → netCashFlow 0, no shortfall. Cash 500,000 funds a +300,000 move into DOMESTIC_STOCK.
    const result = settleRound(input)
    const totalBefore = 500000 + 1000000
    const totalAfter = result.newHouseholdState.cashYen + result.newHouseholdState.assetHoldingsYen.DOMESTIC_STOCK
    expect(totalAfter).toBe(totalBefore)
    expect(result.newHouseholdState.cashYen).toBe(200000)
    expect(result.newHouseholdState.assetHoldingsYen.DOMESTIC_STOCK).toBe(1300000)
  })

  it('an unaffordable reallocation is capped at available cash, never creates money (Critical #2)', () => {
    const input = {
      ...baseInput,
      household: { ...baseHousehold, cashYen: 100000, assetHoldingsYen: { DOMESTIC_STOCK: 1000000 } },
      profile: { ...baseProfile, householdIncomeYen: 0, annualLivingExpensesYen: 0 },
      decision: {
        lessonRunId: 'run-1', householdId: 'case-b', roundIndex: 0,
        assetAllocationChangesYen: { DOMESTIC_STOCK: 5000000 },
        insurancePurchaseIds: [], insuranceCancelIds: [],
        shortfallResolutionType: null, shortfallResolutionAssetType: undefined,
        publicSupportApplicationIds: [], idempotencyKey: 'k3',
      },
      assetCatalog: [{ assetType: 'DOMESTIC_STOCK' as const, valueYen: 0, expectedReturnPercent: 0, volatilityPercent: 0 }],
    }
    // only 100,000 cash available; a request to move 5,000,000 in must be capped at 100,000, not honored in full.
    const result = settleRound(input)
    expect(result.newHouseholdState.cashYen).toBe(0)
    expect(result.newHouseholdState.assetHoldingsYen.DOMESTIC_STOCK).toBe(1100000)
    const totalBefore = 100000 + 1000000
    const totalAfter = result.newHouseholdState.cashYen + result.newHouseholdState.assetHoldingsYen.DOMESTIC_STOCK
    expect(totalAfter).toBe(totalBefore)
  })

  it('a partially-resolved shortfall (SELL_ASSETS capped below the full shortfall) is closed via REDUCE_EXPENSES residual, no free cash (Important #1)', () => {
    const input = {
      ...baseInput,
      household: {
        ...baseHousehold,
        cashYen: 0,
        assetHoldingsYen: { DOMESTIC_STOCK: 1000000 }, // only 1,000,000 liquid, shortfall will be 3,000,000
      },
      profile: { ...baseProfile, householdIncomeYen: 0 },
      decision: {
        lessonRunId: 'run-1', householdId: 'case-b', roundIndex: 0,
        assetAllocationChangesYen: {},
        insurancePurchaseIds: [], insuranceCancelIds: [],
        shortfallResolutionType: 'SELL_ASSETS' as const,
        shortfallResolutionAssetType: 'DOMESTIC_STOCK',
        publicSupportApplicationIds: [], idempotencyKey: 'k4',
      },
      assetCatalog: [{ assetType: 'DOMESTIC_STOCK' as const, valueYen: 0, expectedReturnPercent: 0, volatilityPercent: 0 }],
    }
    // net income 0, expenses 3,000,000 → shortfall 3,000,000. SELL_ASSETS only resolves min(3,000,000, 1,000,000) = 1,000,000.
    // The residual 2,000,000 must be closed via REDUCE_EXPENSES, not forgiven as free cash.
    const result = settleRound(input)
    expect(result.shortfallYen).toBe(3000000)
    expect(result.newHouseholdState.cashYen).toBe(0) // not a windfall — exactly closed, no residual left over
    expect(result.newHouseholdState.assetHoldingsYen.DOMESTIC_STOCK).toBe(0) // fully sold off, capped at what it held
  })

  it('an insurance purchase actually appears in newHouseholdState.activeInsuranceContracts, and a cancellation removes it (Important #2)', () => {
    const input = {
      ...baseInput,
      household: {
        ...baseHousehold,
        activeInsuranceContracts: { 'ins-old': 5 },
      },
      insuranceProducts: [
        {
          id: 'ins-new', productName: '医療保険B', premiumYenPerYear: 10000, coveredRisk: '病気',
          benefitDescription: 'x', benefitAmountYen: 300000, contractYears: 8,
          coveredEventIds: [], internalClaimProbability: 0.3,
        },
        {
          id: 'ins-old', productName: '医療保険A', premiumYenPerYear: 20000, coveredRisk: '病気',
          benefitDescription: 'x', benefitAmountYen: 300000, contractYears: 5,
          coveredEventIds: [], internalClaimProbability: 0.3,
        },
      ],
      decision: {
        lessonRunId: 'run-1', householdId: 'case-b', roundIndex: 0,
        assetAllocationChangesYen: {},
        insurancePurchaseIds: ['ins-new'], insuranceCancelIds: ['ins-old'],
        shortfallResolutionType: null, shortfallResolutionAssetType: undefined,
        publicSupportApplicationIds: [], idempotencyKey: 'k5',
      },
    }
    const result = settleRound(input)
    expect(result.newHouseholdState.activeInsuranceContracts).toEqual({ 'ins-new': 8 })
    expect(result.newHouseholdState.activeInsuranceContracts['ins-old']).toBeUndefined()
  })
})

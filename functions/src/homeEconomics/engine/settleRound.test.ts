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
})

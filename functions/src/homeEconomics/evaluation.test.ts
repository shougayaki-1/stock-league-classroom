import { describe, expect, it } from 'vitest'
import {
  computeBorrowingBurdenScore, computeDiversificationScore, computeEmergencyFundAdequacyScore,
  computeLifeGoalAchievementScore, computeStabilityScore, computeWeightedTotalScore, rankByCriterion,
} from './evaluation'

describe('computeEmergencyFundAdequacyScore', () => {
  it('scores 100 when cash covers 6+ months of living expenses (PROVISIONAL threshold, see Task 17)', () => {
    expect(computeEmergencyFundAdequacyScore({ cashYen: 1500000, annualLivingExpensesYen: 3000000 })).toBe(100)
  })
  it('scores proportionally below the 6-month threshold', () => {
    expect(computeEmergencyFundAdequacyScore({ cashYen: 750000, annualLivingExpensesYen: 3000000 })).toBeCloseTo(50, 0)
  })
  it('never exceeds 100 even with very large savings', () => {
    expect(computeEmergencyFundAdequacyScore({ cashYen: 100000000, annualLivingExpensesYen: 3000000 })).toBe(100)
  })
})

describe('computeDiversificationScore', () => {
  it('scores higher for holdings spread across more asset types than concentrated in one', () => {
    const concentrated = computeDiversificationScore({ DOMESTIC_STOCK: 1000000 })
    const diversified = computeDiversificationScore({ DOMESTIC_STOCK: 250000, FOREIGN_STOCK: 250000, BOND: 250000, CASH: 250000 })
    expect(diversified).toBeGreaterThan(concentrated)
  })
  it('scores 0 for no holdings at all, not NaN or undefined', () => {
    expect(computeDiversificationScore({})).toBe(0)
  })
})

describe('computeBorrowingBurdenScore', () => {
  it('scores 100 for zero debt service', () => {
    expect(computeBorrowingBurdenScore({ annualDebtServiceYen: 0, netIncomeYen: 4800000 })).toBe(100)
  })
  it('scores lower as debt service consumes a larger share of income', () => {
    const light = computeBorrowingBurdenScore({ annualDebtServiceYen: 480000, netIncomeYen: 4800000 })
    const heavy = computeBorrowingBurdenScore({ annualDebtServiceYen: 2400000, netIncomeYen: 4800000 })
    expect(light).toBeGreaterThan(heavy)
  })
})

describe('computeStabilityScore', () => {
  it('scores the fraction of rounds without a shortfall, as a 0-100 score', () => {
    expect(computeStabilityScore({ shortfallRoundCount: 1, totalRounds: 4 })).toBe(75)
  })
  it('scores 100 when there were never any rounds (avoid division by zero)', () => {
    expect(computeStabilityScore({ shortfallRoundCount: 0, totalRounds: 0 })).toBe(100)
  })
})

describe('computeLifeGoalAchievementScore', () => {
  it('scores 100 when the goal was never delayed', () => {
    expect(computeLifeGoalAchievementScore({ goalDelayedRounds: 0, totalRounds: 4 })).toBe(100)
  })
  it('scores lower as more rounds were spent delayed, relative to total rounds', () => {
    expect(computeLifeGoalAchievementScore({ goalDelayedRounds: 2, totalRounds: 4 })).toBe(50)
  })
})

describe('computeWeightedTotalScore', () => {
  const weights = { lifeGoalAchievement: 0.2, emergencyFundAdequacy: 0.15, stability: 0.2, diversification: 0.15, borrowingBurden: 0.15, reflection: 0.15 }

  it('renormalizes remaining weights when reflection (rubric-graded) has not been entered yet — same null-handling as Phase C Task 16', () => {
    const total = computeWeightedTotalScore(
      { lifeGoalAchievement: 100, emergencyFundAdequacy: 80, stability: 90, diversification: 70, borrowingBurden: 60, reflection: null },
      weights,
    )
    const remainingWeightSum = 0.2 + 0.15 + 0.2 + 0.15 + 0.15
    const expected = (100 * 0.2 + 80 * 0.15 + 90 * 0.2 + 70 * 0.15 + 60 * 0.15) / remainingWeightSum
    expect(total).toBeCloseTo(expected, 9)
  })
})

describe('rankByCriterion', () => {
  it('sorts households descending by the given criterion, excluding null scores', () => {
    const households = [{ householdId: 'a', stability: 80 }, { householdId: 'b', stability: null }, { householdId: 'c', stability: 95 }]
    expect(rankByCriterion(households, 'stability').map((h) => h.householdId)).toEqual(['c', 'a'])
  })
})

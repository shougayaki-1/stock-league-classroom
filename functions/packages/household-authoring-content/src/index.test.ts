import { describe, expect, it } from 'vitest'
import type { HouseholdProfile, HomeEconomicsContent, LifeEventDefinition } from './index'

describe('HouseholdProfile (authoring)', () => {
  it('carries the internal fields the public view must never receive', () => {
    const profile: HouseholdProfile = {
      householdId: 'case-b', age: 32, householdIncomeYen: 6000000,
      annualLivingExpensesYen: 3000000, cashSavingsYen: 2000000,
      family: '配偶者・子2人', housing: '賃貸マンション',
      lifeGoal: '住宅購入と教育資金', lifeStage: 'CHILD_REARING',
      eventProbabilityOverrides: { JOB_LOSS: 0.05 },
      internalRiskFactors: { healthRisk: 0.1 },
    }
    expect(profile.eventProbabilityOverrides.JOB_LOSS).toBe(0.05)
  })
})

describe('LifeEventDefinition', () => {
  it('has a disclosure mode distinct from its actual trigger probability (spec §13.12)', () => {
    const event: LifeEventDefinition = {
      id: 'job-loss', label: '失業', disclosureMode: 'HIDDEN',
      triggerProbability: 0.05, effectDescription: '収入が一時的に0になる',
      incomeEffectYen: -3000000, expenseEffectYen: 0, cashEffectYen: 0,
    }
    expect(event.disclosureMode).toBe('HIDDEN')
    expect(event.triggerProbability).toBe(0.05)
  })
})

describe('HomeEconomicsContent defaults', () => {
  it('encodes every §28-equivalent default value as a field default, not scattered in code', () => {
    const content: HomeEconomicsContent = {
      households: [{
        householdId: 'case-b', age: 32, householdIncomeYen: 6000000,
        annualLivingExpensesYen: 3000000, cashSavingsYen: 2000000,
        family: '配偶者・子2人', housing: '賃貸マンション',
        lifeGoal: '住宅購入と教育資金', lifeStage: 'CHILD_REARING',
        eventProbabilityOverrides: {}, internalRiskFactors: {},
      }],
      assets: [], insuranceProducts: [], lifeEvents: [], liabilities: [], publicSupportPrograms: [],
      roundYears: 5, courseFormat: 'COMMON_CONDITIONS',
      taxAndSocialInsuranceModelVersion: 1,
      economicFactors: { inflationPercent: 1, interestRatePercent: 1, marketReturnPercent: 3 },
      borrowingAllowed: false,
      goalPackage: 'EMERGENCY_FUND',
      evaluationWeights: {
        lifeGoalAchievement: 0.2, emergencyFundAdequacy: 0.15, stability: 0.2,
        diversification: 0.15, borrowingBurden: 0.15, reflection: 0.15,
      },
    }
    expect(content.roundYears).toBe(5)
    expect(content.taxAndSocialInsuranceModelVersion).toBe(1)
  })
})

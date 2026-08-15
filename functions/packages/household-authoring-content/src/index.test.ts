import { describe, expect, it } from 'vitest'
import type { HouseholdProfile, LifeEventDefinition } from './index'

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

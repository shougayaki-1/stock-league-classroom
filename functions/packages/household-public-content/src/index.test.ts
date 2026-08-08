import { describe, expect, it } from 'vitest'
import type { AssetPositionPublicView, HouseholdProfilePublicView } from './index'

describe('HouseholdProfilePublicView', () => {
  it('carries only the 7 core profile fields (spec §13.4), never authoring-only internals', () => {
    const view: HouseholdProfilePublicView = {
      householdId: 'case-b', age: 32, householdIncomeYen: 6000000,
      annualLivingExpensesYen: 3000000, cashSavingsYen: 2000000,
      family: '配偶者・子2人', housing: '賃貸マンション',
      lifeGoal: '住宅購入と教育資金', lifeStage: 'CHILD_REARING',
      isFictional: true,
    }
    expect(Object.keys(view)).not.toContain('eventProbabilityOverrides')
    expect(Object.keys(view)).not.toContain('internalRiskFactors')
  })
})

describe('AssetPositionPublicView', () => {
  it('never carries the internal expected-return/volatility coefficients', () => {
    const view: AssetPositionPublicView = {
      assetType: 'DOMESTIC_STOCK', valueYen: 500000,
    }
    expect(Object.keys(view)).not.toContain('expectedReturnPercent')
    expect(Object.keys(view)).not.toContain('volatilityPercent')
  })
})

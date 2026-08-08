import { describe, expect, it } from 'vitest'
import type { AssetPosition, HouseholdProfile, InsuranceProduct } from '@stock-league/household-authoring-content'
import { toAssetPositionsPublicView, toHouseholdProfilePublicView, toInsuranceContractsPublicView } from './toPublicView'

const profile: HouseholdProfile = {
  householdId: 'case-b', age: 32, householdIncomeYen: 6000000,
  annualLivingExpensesYen: 3000000, cashSavingsYen: 2000000,
  family: '配偶者・子2人', housing: '賃貸マンション',
  lifeGoal: '住宅購入と教育資金', lifeStage: 'CHILD_REARING',
  eventProbabilityOverrides: { JOB_LOSS: 0.42 },
  internalRiskFactors: { healthRisk: 0.99 },
}

describe('toHouseholdProfilePublicView', () => {
  it('never leaks eventProbabilityOverrides or internalRiskFactors', () => {
    const view = toHouseholdProfilePublicView(profile)
    expect(JSON.stringify(view)).not.toContain('0.42')
    expect(JSON.stringify(view)).not.toContain('0.99')
    expect(view.isFictional).toBe(true)
  })
})

describe('toAssetPositionsPublicView', () => {
  it('never leaks expectedReturnPercent or volatilityPercent', () => {
    const assets: AssetPosition[] = [{ assetType: 'DOMESTIC_STOCK', valueYen: 500000, expectedReturnPercent: 5, volatilityPercent: 15 }]
    const views = toAssetPositionsPublicView(assets)
    expect(JSON.stringify(views)).not.toContain('expectedReturnPercent')
    expect(JSON.stringify(views)).not.toContain('volatilityPercent')
  })
})

describe('toInsuranceContractsPublicView', () => {
  it('never leaks internalClaimProbability, and keeps insurance out of the asset shape', () => {
    const contracts: InsuranceProduct[] = [{
      id: 'ins-1', productName: '医療保険A', premiumYenPerYear: 60000,
      coveredRisk: '病気・入院', benefitDescription: '入院日額1万円',
      benefitAmountYen: 10000, contractYears: 10, coveredEventIds: ['illness'],
      internalClaimProbability: 0.03,
    }]
    const views = toInsuranceContractsPublicView(contracts)
    expect(JSON.stringify(views)).not.toContain('internalClaimProbability')
    expect(Object.keys(views[0])).not.toContain('assetType')
  })
})

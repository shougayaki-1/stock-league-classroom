import { describe, expect, it } from 'vitest'
import type { InsuranceProduct } from '@stock-league/household-authoring-content'
import { computeAnnualPremiumTotal, computeInsuranceBenefits } from './insurance'

const healthInsurance: InsuranceProduct = {
  id: 'ins-1', productName: '医療保険A', premiumYenPerYear: 60000,
  coveredRisk: '病気・入院', benefitDescription: '入院日額1万円',
  benefitAmountYen: 500000, contractYears: 10, coveredEventIds: ['illness'],
  internalClaimProbability: 0.03,
}
const lifeInsurance: InsuranceProduct = {
  ...healthInsurance, id: 'ins-2', productName: '生命保険B',
  coveredEventIds: ['death'], benefitAmountYen: 3000000,
}

describe('computeAnnualPremiumTotal', () => {
  it('sums the annual premium across every contract', () => {
    expect(computeAnnualPremiumTotal([healthInsurance, lifeInsurance])).toBe(120000)
  })
  it('returns 0 for no contracts', () => {
    expect(computeAnnualPremiumTotal([])).toBe(0)
  })
})

describe('computeInsuranceBenefits', () => {
  it('pays the benefit only for a contract whose covered event actually occurred this round', () => {
    const results = computeInsuranceBenefits([healthInsurance, lifeInsurance], ['illness'])
    expect(results).toEqual([
      { insuranceId: 'ins-1', paidYen: 500000 },
      { insuranceId: 'ins-2', paidYen: 0 },
    ])
  })

  it('does not pay when the occurred event is unrelated to any contract', () => {
    const results = computeInsuranceBenefits([healthInsurance], ['job-loss'])
    expect(results).toEqual([{ insuranceId: 'ins-1', paidYen: 0 }])
  })

  it('internalClaimProbability never influences whether a benefit pays out (spec §13.15 — gates display only)', () => {
    const zeroProbability = { ...healthInsurance, internalClaimProbability: 0 }
    const results = computeInsuranceBenefits([zeroProbability], ['illness'])
    expect(results).toEqual([{ insuranceId: 'ins-1', paidYen: 500000 }])
  })
})

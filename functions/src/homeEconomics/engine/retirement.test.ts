import { describe, expect, it } from 'vitest'
import { computeSimplifiedPensionBenefit, computeVoluntaryAssetDrawdown } from './retirement'

describe('computeSimplifiedPensionBenefit', () => {
  it('applies the replacement rate to pre-retirement income (spec §13.14: 収入減少・年金等の簡略給付)', () => {
    expect(computeSimplifiedPensionBenefit({ preRetirementIncomeYen: 6000000, pensionReplacementRatePercent: 50 })).toBe(3000000)
  })

  it('a 0% replacement rate means no pension — never a negative or undefined value', () => {
    expect(computeSimplifiedPensionBenefit({ preRetirementIncomeYen: 6000000, pensionReplacementRatePercent: 0 })).toBe(0)
  })
})

describe('computeVoluntaryAssetDrawdown', () => {
  it('withdraws exactly the requested amount, capped at what is actually held', () => {
    const result = computeVoluntaryAssetDrawdown({ requestedYen: 500000, assetHoldingsYen: { DOMESTIC_STOCK: 2000000, CASH: 100000 } })
    expect(result.withdrawnYen).toBe(500000)
  })

  it('caps the withdrawal at total holdings when the request exceeds what is held (spec §13.14: never goes negative)', () => {
    const result = computeVoluntaryAssetDrawdown({ requestedYen: 5000000, assetHoldingsYen: { DOMESTIC_STOCK: 2000000 } })
    expect(result.withdrawnYen).toBe(2000000)
  })

  it('withdraws proportionally across held asset types, never emptying one type before touching another (spec §13.5: diversification is part of what §13.17 evaluates)', () => {
    const result = computeVoluntaryAssetDrawdown({ requestedYen: 300000, assetHoldingsYen: { DOMESTIC_STOCK: 1000000, FOREIGN_STOCK: 500000 } })
    // 300,000 split 2:1 by holding weight → 200,000 from DOMESTIC_STOCK, 100,000 from FOREIGN_STOCK
    expect(result.newAssetHoldingsYen.DOMESTIC_STOCK).toBe(800000)
    expect(result.newAssetHoldingsYen.FOREIGN_STOCK).toBe(400000)
  })

  it('conserves money exactly: sum(newAssetHoldingsYen) + withdrawnYen equals original totalHeldYen (no rounding errors)', () => {
    const result = computeVoluntaryAssetDrawdown({
      requestedYen: 1000000,
      assetHoldingsYen: { A: 1000000, B: 700000, C: 333333 },
    })
    const originalTotal = 1000000 + 700000 + 333333
    const newTotal = Object.values(result.newAssetHoldingsYen).reduce((sum, v) => sum + v, 0) + result.withdrawnYen
    expect(newTotal).toBe(originalTotal)
  })
})

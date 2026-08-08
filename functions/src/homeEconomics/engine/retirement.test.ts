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

  it('never drives any single entry negative, even when the largest-remainder residual would exceed the last entry (regression for the "last entry absorbs residual" bug)', () => {
    const holdings = { X1: 3, X2: 3, X3: 3, X4: 3, LAST: 1 }
    const result = computeVoluntaryAssetDrawdown({ requestedYen: 10, assetHoldingsYen: holdings })
    for (const value of Object.values(result.newAssetHoldingsYen)) {
      expect(value).toBeGreaterThanOrEqual(0)
    }
    const originalTotal = Object.values(holdings).reduce((sum, v) => sum + v, 0)
    const newTotal = Object.values(result.newAssetHoldingsYen).reduce((sum, v) => sum + v, 0) + result.withdrawnYen
    expect(newTotal).toBe(originalTotal)
  })

  it.each<Record<string, number>>([
    { A: 7, B: 7, C: 7, D: 1 }, // requesting near-total forces heavy remainder distribution across small holdings
    { ONLY: 5 },
    { A: 1, B: 1, C: 1 },
    { A: 100, B: 1 },
    { A: 1000000, B: 1, C: 1, D: 1, E: 1 },
  ])('conserves the total and never goes negative for holdings %j across a range of requested amounts', (holdings) => {
    const originalTotal = Object.values(holdings).reduce((sum, v) => sum + v, 0)
    for (const requestedYen of [0, 1, 2, Math.ceil(originalTotal / 2), originalTotal, originalTotal * 2]) {
      const result = computeVoluntaryAssetDrawdown({ requestedYen, assetHoldingsYen: holdings })
      for (const value of Object.values(result.newAssetHoldingsYen)) {
        expect(value).toBeGreaterThanOrEqual(0)
      }
      const newTotal = Object.values(result.newAssetHoldingsYen).reduce((sum, v) => sum + v, 0) + result.withdrawnYen
      expect(newTotal).toBe(originalTotal)
    }
  })
})

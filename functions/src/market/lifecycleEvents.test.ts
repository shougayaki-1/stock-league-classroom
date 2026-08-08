import { describe, expect, it } from 'vitest'
import { applyBankruptcy, applyDividend, applyStockSplit } from './lifecycleEvents'

describe('applyBankruptcy', () => {
  it('sets the price to exactly 0, ignoring the price guard (spec §12.23 "倒産イベントだけガードを無視")', () => {
    const result = applyBankruptcy({ currentPrice: 500, priceGuard: { type: 'ABSOLUTE', minimumPrice: 100 } })
    expect(result.newPrice).toBe(0)
    expect(result.tradingHalted).toBe(true)
  })
})

describe('applyDividend', () => {
  it('pays cash proportional to holdings, at the configured per-share amount', () => {
    expect(applyDividend({ heldShares: 10, dividendPerShare: 20 })).toBe(200)
  })
  it('pays nothing for zero holdings', () => {
    expect(applyDividend({ heldShares: 0, dividendPerShare: 20 })).toBe(0)
  })
})

describe('applyStockSplit', () => {
  it('divides price and multiplies holdings by the split ratio (e.g. a 1:2 split)', () => {
    const result = applyStockSplit({ price: 2000, heldShares: 10, splitRatio: 2 })
    expect(result).toEqual({ newPrice: 1000, newHeldShares: 20 })
  })
})

import { describe, expect, it } from 'vitest'
import { applyShortfallResolution, buildShortfallOptions, detectShortfall } from './shortfallOptions'

describe('detectShortfall', () => {
  it('returns 0 when savings cover a negative cash flow', () => {
    expect(detectShortfall({ cashSavingsYen: 1000000, netCashFlowYen: -500000 })).toBe(0)
  })
  it('returns the exact shortfall amount when savings run out', () => {
    expect(detectShortfall({ cashSavingsYen: 300000, netCashFlowYen: -500000 })).toBe(200000)
  })
  it('returns 0 for a positive cash flow regardless of savings', () => {
    expect(detectShortfall({ cashSavingsYen: 0, netCashFlowYen: 100000 })).toBe(0)
  })
})

describe('buildShortfallOptions', () => {
  it('always includes REDUCE_EXPENSES and DELAY_GOAL — always available regardless of assets/permissions (spec §13.13)', () => {
    const options = buildShortfallOptions({ shortfallYen: 200000, liquidAssetsYen: 0, publicSupportAvailableYen: 0, borrowingAllowed: false })
    const types = options.map((o) => o.type)
    expect(types).toContain('REDUCE_EXPENSES')
    expect(types).toContain('DELAY_GOAL')
    expect(types).not.toContain('SELL_ASSETS')
    expect(types).not.toContain('BORROW')
    expect(types).not.toContain('PUBLIC_SUPPORT')
  })

  it('includes SELL_ASSETS only when liquid assets exist, BORROW only when the template allows it, PUBLIC_SUPPORT only when available', () => {
    const options = buildShortfallOptions({ shortfallYen: 200000, liquidAssetsYen: 500000, publicSupportAvailableYen: 100000, borrowingAllowed: true })
    const types = options.map((o) => o.type)
    expect(types).toEqual(expect.arrayContaining(['REDUCE_EXPENSES', 'SELL_ASSETS', 'BORROW', 'PUBLIC_SUPPORT', 'DELAY_GOAL']))
  })

  it('caps SELL_ASSETS\'s resolvesYen at whichever is smaller — the shortfall or the available liquid assets', () => {
    const options = buildShortfallOptions({ shortfallYen: 200000, liquidAssetsYen: 50000, publicSupportAvailableYen: 0, borrowingAllowed: false })
    const sellAssets = options.find((o) => o.type === 'SELL_ASSETS')
    expect(sellAssets?.resolvesYen).toBe(50000)
  })
})

describe('applyShortfallResolution', () => {
  it('SELL_ASSETS converts assetDelta negative and cashDelta positive by the same amount', () => {
    const result = applyShortfallResolution({ type: 'SELL_ASSETS', description: 'x', resolvesYen: 150000 }, 200000)
    expect(result).toEqual({ cashDeltaYen: 150000, assetDeltaYen: -150000, newLiabilityYen: 0, goalDelayedRounds: 0 })
  })

  it('BORROW creates a new liability for the full shortfall, not just the option\'s resolvesYen cap', () => {
    const result = applyShortfallResolution({ type: 'BORROW', description: 'x', resolvesYen: 999999999 }, 200000)
    expect(result).toEqual({ cashDeltaYen: 200000, assetDeltaYen: 0, newLiabilityYen: 200000, goalDelayedRounds: 0 })
  })

  it('DELAY_GOAL resolves the shortfall with no cash movement, only a delay', () => {
    const result = applyShortfallResolution({ type: 'DELAY_GOAL', description: 'x', resolvesYen: 200000 }, 200000)
    expect(result).toEqual({ cashDeltaYen: 0, assetDeltaYen: 0, newLiabilityYen: 0, goalDelayedRounds: 1 })
  })

  it('REDUCE_EXPENSES covers the shortfall by cutting this round\'s spending — a real cash resolution, not a no-op', () => {
    const result = applyShortfallResolution({ type: 'REDUCE_EXPENSES', description: 'x', resolvesYen: 200000 }, 200000)
    expect(result).toEqual({ cashDeltaYen: 200000, assetDeltaYen: 0, newLiabilityYen: 0, goalDelayedRounds: 0 })
  })
})

import { describe, expect, it } from 'vitest'
import { computeAssetReturn } from './assetReturn'

const baseInput = {
  assetType: 'DOMESTIC_STOCK' as const, valueYen: 1000000,
  expectedReturnPercent: 5, volatilityPercent: 15,
  marketReturnPercent: 3, householdId: 'case-b', roundIndex: 2,
  randomSeed: 'seed-abc', restoreGeneration: 0,
}

describe('computeAssetReturn', () => {
  it('is deterministic — same inputs always produce the same nextValueYen', () => {
    expect(computeAssetReturn(baseInput)).toEqual(computeAssetReturn(baseInput))
  })

  it('a different roundIndex produces a different result — the noise term is not constant across rounds', () => {
    const round2 = computeAssetReturn(baseInput)
    const round3 = computeAssetReturn({ ...baseInput, roundIndex: 3 })
    expect(round2.nextValueYen).not.toBe(round3.nextValueYen)
  })

  it('a different householdId produces a different result — the seed varies per household', () => {
    const a = computeAssetReturn(baseInput)
    const b = computeAssetReturn({ ...baseInput, householdId: 'case-c' })
    expect(a.nextValueYen).not.toBe(b.nextValueYen)
  })

  it('CASH never carries a noise term — zero volatility is exact, not approximate (spec §13.5)', () => {
    // NOTE: the task brief's own test snippet left marketReturnPercent at
    // the baseInput's 3, which makes nextValueYen === valueYen impossible
    // to satisfy (1000000 * 1.03 !== 1000000). The test's own description
    // is about isolating the *noise* term to exactly zero, so
    // marketReturnPercent must be zeroed here too — fixed to match intent.
    const result = computeAssetReturn({
      ...baseInput, assetType: 'CASH', expectedReturnPercent: 0, volatilityPercent: 0, marketReturnPercent: 0,
    })
    expect(result.nextValueYen).toBe(baseInput.valueYen)
    expect(result.returnPercent).toBe(0)
  })

  it('never returns a negative value even with a large negative noise draw', () => {
    const result = computeAssetReturn({ ...baseInput, expectedReturnPercent: -50, volatilityPercent: 200 })
    expect(result.nextValueYen).toBeGreaterThanOrEqual(0)
  })

  it('the noise term is bounded by volatilityPercent — returnPercent stays within expected+market ± volatility', () => {
    const result = computeAssetReturn(baseInput)
    const base = baseInput.expectedReturnPercent + baseInput.marketReturnPercent
    expect(result.returnPercent).toBeGreaterThanOrEqual(base - baseInput.volatilityPercent)
    expect(result.returnPercent).toBeLessThanOrEqual(base + baseInput.volatilityPercent)
  })

  it('economic factors are reflected in the baseline — higher marketReturnPercent shifts returnPercent up by the same delta (noise term held fixed via seed)', () => {
    const low = computeAssetReturn({ ...baseInput, marketReturnPercent: 0 })
    const high = computeAssetReturn({ ...baseInput, marketReturnPercent: 10 })
    expect(high.returnPercent - low.returnPercent).toBeCloseTo(10, 10)
  })

  it('expectedReturnPercent shifts the baseline the same way', () => {
    const low = computeAssetReturn({ ...baseInput, expectedReturnPercent: 0 })
    const high = computeAssetReturn({ ...baseInput, expectedReturnPercent: 20 })
    expect(high.returnPercent - low.returnPercent).toBeCloseTo(20, 10)
  })
})

import { describe, expect, it } from 'vitest'
import { applyPriceGuard, calculateNextPrice, effectiveMarketSizeForCompany } from './priceCalculation'

describe('applyPriceGuard', () => {
  it('clamps to the absolute minimum (spec §12.23 default is 1 yen)', () => {
    expect(applyPriceGuard(0.5, { type: 'ABSOLUTE', minimumPrice: 1 }, 1000)).toEqual({ price: 1, guardApplied: true })
  })
  it('does not clamp when above the minimum', () => {
    expect(applyPriceGuard(500, { type: 'ABSOLUTE', minimumPrice: 1 }, 1000)).toEqual({ price: 500, guardApplied: false })
  })
  it('clamps to a percentage of the initial price', () => {
    expect(applyPriceGuard(50, { type: 'PERCENT_OF_INITIAL', minimumPercent: 10 }, 1000)).toEqual({ price: 100, guardApplied: true })
  })
})

describe('calculateNextPrice', () => {
  const baseInput = {
    currentPrice: 1000,
    initialPrice: 1000,
    informationImpactPercent: 4.2,
    netDemandValue: -500,
    effectiveMarketSize: 50000,
    demandSensitivity: 1,
    priceSensitivityPreset: 'BALANCED' as const,
    noiseEnabled: true,
    randomSeed: 'run-abc', restoreGeneration: 0, stockId: 'acme', batchIndex: 3,
    priceGuard: { type: 'ABSOLUTE' as const, minimumPrice: 1 },
  }

  it('is deterministic for the same seed inputs (spec §26-1 / 矛盾解消D)', () => {
    const first = calculateNextPrice(baseInput)
    const second = calculateNextPrice(baseInput)
    expect(first).toEqual(second)
  })

  it('produces a different noise term when restoreGeneration changes', () => {
    const before = calculateNextPrice(baseInput)
    const after = calculateNextPrice({ ...baseInput, restoreGeneration: 1 })
    expect(before.breakdown.otherPercent).not.toBe(after.breakdown.otherPercent)
  })

  it('breaks down into news/demand/other/total, matching the §12.31 display', () => {
    const result = calculateNextPrice(baseInput)
    expect(result.breakdown.total).toBeCloseTo(
      result.breakdown.informationPercent + result.breakdown.demandPercent + result.breakdown.otherPercent,
      9,
    )
  })

  it('applies BALANCED preset with equal 1x weight on information and demand', () => {
    const result = calculateNextPrice({ ...baseInput, noiseEnabled: false })
    const expectedDemandPercent = (baseInput.netDemandValue / baseInput.effectiveMarketSize) * baseInput.demandSensitivity * 100
    expect(result.breakdown.informationPercent).toBeCloseTo(4.2, 9)
    expect(result.breakdown.demandPercent).toBeCloseTo(expectedDemandPercent, 9)
  })

  it('flags a sudden-change warning above the configured threshold without blocking the price', () => {
    const result = calculateNextPrice({ ...baseInput, informationImpactPercent: 20, noiseEnabled: false })
    expect(result.suddenChangeWarning).toBe(true)
    expect(result.nextPrice).toBeGreaterThan(baseInput.currentPrice) // still moves — no hard cap (spec §12.20/§12.24)
  })

  it('never returns a price below the guard even with a large negative swing', () => {
    const result = calculateNextPrice({
      ...baseInput, informationImpactPercent: -95, netDemandValue: -100000, noiseEnabled: false,
    })
    expect(result.nextPrice).toBe(1)
    expect(result.guardApplied).toBe(true)
  })
})

describe('effectiveMarketSizeForCompany', () => {
  it('maps SMALL/MEDIUM/LARGE to increasing market sizes — smaller companies move more per unit of demand', () => {
    expect(effectiveMarketSizeForCompany('SMALL')).toBeLessThan(effectiveMarketSizeForCompany('MEDIUM'))
    expect(effectiveMarketSizeForCompany('MEDIUM')).toBeLessThan(effectiveMarketSizeForCompany('LARGE'))
  })
})

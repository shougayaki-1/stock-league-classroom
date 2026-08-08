import { describe, expect, it } from 'vitest'
import { informationImpactPercent, SHORT_TERM_WINDOW_BATCHES } from './informationImpact'

describe('informationImpactPercent', () => {
  it('uses shortTermImpact when still within the short-term window after publication', () => {
    const percent = informationImpactPercent({
      baseDirection: 'POSITIVE',
      strength: 5,
      shortTermImpact: 8,
      longTermImpact: 2,
      batchesSincePublication: 0,
    })
    expect(percent).toBe(8)
  })

  it('switches to longTermImpact once the short-term window has elapsed', () => {
    const percent = informationImpactPercent({
      baseDirection: 'POSITIVE',
      strength: 5,
      shortTermImpact: 8,
      longTermImpact: 2,
      batchesSincePublication: SHORT_TERM_WINDOW_BATCHES,
    })
    expect(percent).toBe(2)
  })

  it('falls back to strength when shortTermImpact/longTermImpact are not provided', () => {
    expect(informationImpactPercent({
      baseDirection: 'NEGATIVE', strength: 3, batchesSincePublication: 0,
    })).toBe(-3)
    expect(informationImpactPercent({
      baseDirection: 'NEGATIVE', strength: 3, batchesSincePublication: SHORT_TERM_WINDOW_BATCHES + 1,
    })).toBe(-3)
  })

  it('applies direction sign — NEGATIVE flips the magnitude negative', () => {
    const percent = informationImpactPercent({
      baseDirection: 'NEGATIVE', strength: 5, shortTermImpact: 8, longTermImpact: 2, batchesSincePublication: 0,
    })
    expect(percent).toBe(-8)
  })

  it('MIXED and NEUTRAL directions contribute zero net impact', () => {
    expect(informationImpactPercent({
      baseDirection: 'MIXED', strength: 5, shortTermImpact: 8, batchesSincePublication: 0,
    })).toBe(0)
    expect(informationImpactPercent({
      baseDirection: 'NEUTRAL', strength: 5, shortTermImpact: 8, batchesSincePublication: 0,
    })).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { aggregateDemand, nettedFillForParticipant } from './demandAggregation'

describe('nettedFillForParticipant', () => {
  it('nets 5 buy + 2 sell of the same stock into a 3-share buy (spec §12.14 example)', () => {
    expect(nettedFillForParticipant([
      { side: 'BUY', quantity: 5 }, { side: 'SELL', quantity: 2 },
    ])).toEqual({ side: 'BUY', quantity: 3 })
  })

  it('nets equal buy and sell quantities to no trade', () => {
    expect(nettedFillForParticipant([
      { side: 'BUY', quantity: 4 }, { side: 'SELL', quantity: 4 },
    ])).toBeNull()
  })

  it('nets a sell-heavy mix into a net sell', () => {
    expect(nettedFillForParticipant([
      { side: 'BUY', quantity: 2 }, { side: 'SELL', quantity: 5 },
    ])).toEqual({ side: 'SELL', quantity: 3 })
  })
})

describe('aggregateDemand', () => {
  it('uses NET (post-netting) value for demand and GROSS (pre-netting) quantity for volume — 矛盾解消C', () => {
    // Two participants: one nets to a 3-share buy, the other to a 2-share sell.
    const result = aggregateDemand({
      executionPrice: 1000,
      nettedFills: [{ side: 'BUY', quantity: 3 }, { side: 'SELL', quantity: 2 }],
      rawOrders: [
        { side: 'BUY', quantity: 5 }, { side: 'SELL', quantity: 2 }, // participant 1's raw orders (nets to 3 buy)
        { side: 'SELL', quantity: 2 }, // participant 2's raw order (nets to 2 sell, no netting needed)
      ],
    })
    expect(result.netDemandValue).toBe(3 * 1000 - 2 * 1000) // 1,000 yen net buying pressure
    expect(result.displayedVolumeShares).toBe(5 + 2 + 2) // 9 shares — the GROSS total, not 5
  })

  it('cannot be gamed by pairing a large buy with an almost-equal sell in the same batch', () => {
    // The manipulation resolution C calls out: "100株買い・98株売り" nets to
    // a 2-share buy — demand pressure must reflect only the 2 net shares,
    // not the 100 gross shares, even though volume still shows 198.
    const result = aggregateDemand({
      executionPrice: 1000,
      nettedFills: [{ side: 'BUY', quantity: 2 }],
      rawOrders: [{ side: 'BUY', quantity: 100 }, { side: 'SELL', quantity: 98 }],
    })
    expect(result.netDemandValue).toBe(2 * 1000)
    expect(result.displayedVolumeShares).toBe(198)
  })

  it('returns zero net demand and zero volume for an empty batch', () => {
    expect(aggregateDemand({ executionPrice: 1000, nettedFills: [], rawOrders: [] }))
      .toEqual({ netDemandValue: 0, displayedVolumeShares: 0 })
  })
})

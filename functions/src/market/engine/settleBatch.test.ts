import { describe, expect, it } from 'vitest'
import { settleBatch } from './settleBatch'

const stock = (overrides: Partial<Parameters<typeof settleBatch>[0]['stocks'][number]> = {}) => ({
  stockId: 'acme', currentPrice: 1000, initialPrice: 1000,
  priceGuard: { type: 'ABSOLUTE' as const, minimumPrice: 1 },
  effectiveMarketSize: 100000, demandSensitivity: 1, informationImpactPercent: 0,
  ...overrides,
})

const baseInput = {
  lessonRunId: 'run-1', batchId: 'batch-3', batchIndex: 3,
  randomSeed: 'seed', restoreGeneration: 0,
  priceSensitivityPreset: 'BALANCED' as const, noiseEnabled: false,
}

describe('settleBatch', () => {
  it('fills all orders for a stock at the SAME price — the price in effect before this batch (spec §12.10)', () => {
    const result = settleBatch({
      ...baseInput,
      stocks: [stock()],
      orders: [
        { orderId: 'o1', teamId: 'team-a', stockId: 'acme', side: 'BUY', quantity: 3, referencePrice: 950 },
        { orderId: 'o2', teamId: 'team-b', stockId: 'acme', side: 'BUY', quantity: 2, referencePrice: 1050 },
      ],
      teamAccounts: [
        { teamId: 'team-a', cash: 10000, holdings: {} },
        { teamId: 'team-b', cash: 10000, holdings: {} },
      ],
    })
    expect(result.orders).toEqual([
      { orderId: 'o1', status: 'FILLED', executionPrice: 1000 },
      { orderId: 'o2', status: 'FILLED', executionPrice: 1000 },
    ])
  })

  it('nets 5 buy + 2 sell of the same stock/team into a 3-share buy, both original orders FILLED (spec §12.14)', () => {
    const result = settleBatch({
      ...baseInput,
      stocks: [stock()],
      orders: [
        { orderId: 'o1', teamId: 'team-a', stockId: 'acme', side: 'BUY', quantity: 5, referencePrice: 1000 },
        { orderId: 'o2', teamId: 'team-a', stockId: 'acme', side: 'SELL', quantity: 2, referencePrice: 1000 },
      ],
      teamAccounts: [{ teamId: 'team-a', cash: 10000, holdings: { acme: 2 } }],
    })
    expect(result.orders.every((o) => o.status === 'FILLED')).toBe(true)
    // portfolio effect reflects the NET 3-share buy only, not 5 buy + 2 sell independently
    expect(result.teamAccountUpdates).toEqual([
      { teamId: 'team-a', cashDelta: -3000, holdingsDelta: { acme: 3 } },
    ])
  })

  it('rejects ALL of a team\'s buy orders ACROSS EVERY STOCK when the aggregated cost exceeds cash (spec §12.15)', () => {
    const result = settleBatch({
      ...baseInput,
      stocks: [stock({ stockId: 'acme' }), stock({ stockId: 'globex', currentPrice: 1500 })],
      orders: [
        { orderId: 'o1', teamId: 'team-a', stockId: 'acme', side: 'BUY', quantity: 3, referencePrice: 1000 }, // 3,000
        { orderId: 'o2', teamId: 'team-a', stockId: 'globex', side: 'BUY', quantity: 5, referencePrice: 1500 }, // 7,500 → total 10,500
      ],
      teamAccounts: [{ teamId: 'team-a', cash: 10000, holdings: {} }],
    })
    expect(result.orders).toEqual(expect.arrayContaining([
      { orderId: 'o1', status: 'REJECTED', rejectionReason: expect.any(String) },
      { orderId: 'o2', status: 'REJECTED', rejectionReason: expect.any(String) },
    ]))
    expect(result.teamAccountUpdates).toEqual([])
  })

  it('a sell shortfall in one stock does not reject a healthy buy in another stock for the same team', () => {
    const result = settleBatch({
      ...baseInput,
      stocks: [stock({ stockId: 'acme' }), stock({ stockId: 'globex', currentPrice: 500 })],
      orders: [
        { orderId: 'o1', teamId: 'team-a', stockId: 'acme', side: 'SELL', quantity: 10, referencePrice: 1000 }, // only holds 2
        { orderId: 'o2', teamId: 'team-a', stockId: 'globex', side: 'BUY', quantity: 4, referencePrice: 500 }, // 2,000, affordable
      ],
      teamAccounts: [{ teamId: 'team-a', cash: 5000, holdings: { acme: 2 } }],
    })
    expect(result.orders).toEqual(expect.arrayContaining([
      { orderId: 'o1', status: 'REJECTED', rejectionReason: expect.any(String) },
      { orderId: 'o2', status: 'FILLED', executionPrice: 500 },
    ]))
    expect(result.teamAccountUpdates).toEqual([{ teamId: 'team-a', cashDelta: -2000, holdingsDelta: { globex: 4 } }])
  })

  it('excludes rejected orders from both net demand and displayed volume (矛盾解消C)', () => {
    const result = settleBatch({
      ...baseInput,
      stocks: [stock()],
      orders: [
        // team-a's buy fails (insufficient cash) — must not move the price or count as volume
        { orderId: 'o1', teamId: 'team-a', stockId: 'acme', side: 'BUY', quantity: 100, referencePrice: 1000 },
        // team-b's buy succeeds
        { orderId: 'o2', teamId: 'team-b', stockId: 'acme', side: 'BUY', quantity: 3, referencePrice: 1000 },
      ],
      teamAccounts: [
        { teamId: 'team-a', cash: 500, holdings: {} },
        { teamId: 'team-b', cash: 10000, holdings: {} },
      ],
    })
    const acmeResult = result.stocks.find((s) => s.stockId === 'acme')!
    expect(acmeResult.netDemandValue).toBe(3000) // only team-b's 3 shares
    expect(acmeResult.displayedVolumeShares).toBe(3) // team-a's rejected 100 does not count
  })

  it('computes the next price from the settled net demand via calculateNextPrice (Task 3)', () => {
    const result = settleBatch({
      ...baseInput,
      stocks: [stock({ informationImpactPercent: 2 })],
      orders: [{ orderId: 'o1', teamId: 'team-a', stockId: 'acme', side: 'BUY', quantity: 10, referencePrice: 1000 }],
      teamAccounts: [{ teamId: 'team-a', cash: 100000, holdings: {} }],
    })
    const acmeResult = result.stocks.find((s) => s.stockId === 'acme')!
    expect(acmeResult.breakdown.informationPercent).toBeCloseTo(2, 9)
    expect(acmeResult.nextPrice).toBeGreaterThan(1000) // net buying + positive info both push price up
  })
})

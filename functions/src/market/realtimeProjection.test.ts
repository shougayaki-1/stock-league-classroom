import { describe, expect, it } from 'vitest'
import { toComputationLog, toMyOrdersView, toStockPublicStates } from './realtimeProjection'
import type { StockSettlementResult } from './engine/settleBatch'
import type { MarketOrder } from './orderTypes'

const stockResult = (overrides: Partial<StockSettlementResult> = {}): StockSettlementResult => ({
  stockId: 'stock-1',
  executionPrice: 1000,
  nextPrice: 1050,
  breakdown: { informationPercent: 2, demandPercent: 3, otherPercent: 0.5, total: 5.5 },
  guardApplied: false,
  suddenChangeWarning: false,
  displayedVolumeShares: 42,
  netDemandValue: 12345,
  ...overrides,
})

describe('toStockPublicStates', () => {
  it('maps executionPrice to previousPrice and nextPrice to currentPrice, keyed by stockId', () => {
    const out = toStockPublicStates([stockResult()])
    expect(out['stock-1']).toEqual({
      currentPrice: 1050,
      previousPrice: 1000,
      guardApplied: false,
      suddenChangeWarning: false,
      breakdown: { informationPercent: 2, demandPercent: 3, otherPercent: 0.5, total: 5.5 },
      displayedVolumeShares: 42,
    })
  })

  it('never includes netDemandValue or any field beyond the public allow-list (spec §26-1)', () => {
    const out = toStockPublicStates([stockResult({ netDemandValue: 999999 })])
    const keys = Object.keys(out['stock-1'])
    expect(keys.sort()).toEqual(['breakdown', 'currentPrice', 'displayedVolumeShares', 'guardApplied', 'previousPrice', 'suddenChangeWarning'])
    expect(JSON.stringify(out)).not.toContain('999999')
  })

  it('handles multiple stocks keyed independently', () => {
    const out = toStockPublicStates([stockResult({ stockId: 'a' }), stockResult({ stockId: 'b', nextPrice: 2000 })])
    expect(Object.keys(out).sort()).toEqual(['a', 'b'])
    expect(out.b.currentPrice).toBe(2000)
  })
})

describe('toComputationLog', () => {
  it('includes the internal priceSensitivityPreset coefficient alongside the breakdown figures', () => {
    const out = toComputationLog([stockResult()], 'DEMAND_FOCUSED')
    expect(out['stock-1']).toEqual({
      informationImpactPercent: 2,
      demandImpactPercent: 3,
      noisePercent: 0.5,
      priceSensitivityPreset: 'DEMAND_FOCUSED',
    })
  })

  it('applies the same preset to every stock in the batch', () => {
    const out = toComputationLog([stockResult({ stockId: 'a' }), stockResult({ stockId: 'b' })], 'BALANCED')
    expect(out.a.priceSensitivityPreset).toBe('BALANCED')
    expect(out.b.priceSensitivityPreset).toBe('BALANCED')
  })
})

describe('toMyOrdersView', () => {
  const order = (overrides: Partial<MarketOrder> = {}): MarketOrder => ({
    orderId: 'order-1',
    idempotencyKey: 'key-1',
    lessonRunId: 'run-1',
    batchId: 'run-1_batch_1',
    teamId: 'team-1',
    stockId: 'stock-1',
    side: 'BUY',
    quantity: 10,
    referencePrice: 1000,
    status: 'FILLED',
    submittedAtServerMillis: 1000,
    ...overrides,
  })

  it('projects the fields a team may see about its own order', () => {
    const out = toMyOrdersView([order({ executionPrice: 1050 })])
    expect(out).toEqual([{
      orderId: 'order-1', stockId: 'stock-1', side: 'BUY', quantity: 10,
      status: 'FILLED', referencePrice: 1000, executionPrice: 1050,
    }])
  })

  it('omits executionPrice when the order has none yet (still PENDING)', () => {
    const out = toMyOrdersView([order({ status: 'PENDING', executionPrice: undefined })])
    expect(out[0]).not.toHaveProperty('executionPrice')
  })

  it('never includes participantId, idempotencyKey, batchId, or lessonRunId', () => {
    const out = toMyOrdersView([order({ participantId: 'p1' })])
    const keys = Object.keys(out[0])
    expect(keys).not.toContain('participantId')
    expect(keys).not.toContain('idempotencyKey')
    expect(keys).not.toContain('batchId')
    expect(keys).not.toContain('lessonRunId')
  })
})

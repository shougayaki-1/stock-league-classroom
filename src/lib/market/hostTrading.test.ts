import { describe, expect, it } from 'vitest'
import { calculateOrderFill, priceAtRuntime, shouldPauseLease } from './hostTrading'
import type { LiveMarketState } from './liveMarketTypes'

describe('trading fill policy', () => {
  it('reduces buy and sell quantities to available cash or holdings', () => {
    expect(calculateOrderFill({ orderId: 'a', stockId: 'x', side: 'BUY', quantity: 10, submittedAtMillis: 1 }, 30, { cash: 95, holdings: {}, updatedAtMillis: 1 }, 2).filledQuantity).toBe(3)
    expect(calculateOrderFill({ orderId: 'b', stockId: 'x', side: 'SELL', quantity: 10, submittedAtMillis: 1 }, 30, { cash: 0, holdings: { x: 2 }, updatedAtMillis: 1 }, 2).filledQuantity).toBe(2)
  })
})

describe('phase runtime', () => {
  it('preserves the phase start price and progresses across one-second ticks', () => {
    const runtime = { startPrice: 100, endPrice: 160, startAtMillis: 1_000, endAtMillis: 61_000 }
    expect(priceAtRuntime(runtime, 100, 1_000)).toBe(100)
    expect(priceAtRuntime(runtime, 100, 2_000)).toBe(101)
    expect(priceAtRuntime(runtime, 100, 61_000)).toBe(160)
  })
})

describe('lease-specific disconnect markers', () => {
  it('does not let old connection A pause same-owner lease L2 after L1 was replaced', () => {
    const state: LiveMarketState = { meta: { ownerUid: 'teacher', capacity: 80, visibility: 'private', status: 'OPEN', createdAtMillis: 1 }, teams: {}, hostLease: { ownerUid: 'teacher', leaseId: 'L2', expiresAtMillis: 2_000, paused: false }, hostDisconnects: { L1: { ownerUid: 'teacher', disconnectedAtMillis: 2 } } }
    expect(shouldPauseLease(state, 'teacher', 'L1', 100)).toBe(false)
    expect(shouldPauseLease(state, 'teacher', 'L2', 100)).toBe(false)
    state.hostDisconnects!.L2 = { ownerUid: 'teacher', disconnectedAtMillis: 3 }
    expect(shouldPauseLease(state, 'teacher', 'L2', 100)).toBe(true)
  })
})

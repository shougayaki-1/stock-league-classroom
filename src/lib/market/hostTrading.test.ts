import { describe, expect, it } from 'vitest'
import { applyNewsImpact, applyPauseMarket, applyUpdateMarketCompanies, calculateOrderFill, deriveStocksFromCompanies, priceAtRuntime, rankTeams, shouldPauseLease, validateMarketCompanies } from './hostTrading'
import { clampToBounds } from '../pricing/pricingCore'
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

describe('team leaderboard', () => {
  it('uses shared team portfolios and competition ranking for ties', () => {
    const leaderboard = rankTeams({
      teams: { red: { id: 'red', name: '赤' }, blue: { id: 'blue', name: '青' }, green: { id: 'green', name: '緑' } },
      participants: {
        p1: { uid: '1', sessionId: 's', displayName: 'A', teamId: 'red', connected: true, lastSeenAtMillis: 1 },
        p2: { uid: '2', sessionId: 's', displayName: 'B', teamId: 'blue', connected: true, lastSeenAtMillis: 1 },
        p3: { uid: '3', sessionId: 's', displayName: 'C', teamId: 'green', connected: true, lastSeenAtMillis: 1 },
      },
      teamPortfolios: {
        red: { cash: 1000, holdings: {}, updatedAtMillis: 1 },
        blue: { cash: 1000, holdings: {}, updatedAtMillis: 1 },
        green: { cash: 500, holdings: { x: 2 }, updatedAtMillis: 1 },
      },
      prices: { x: { price: 100, updatedAtMillis: 1 } },
    })
    expect(leaderboard.red.rank).toBe(1)
    expect(leaderboard.blue.rank).toBe(1)
    expect(leaderboard.green.rank).toBe(3)
    expect(leaderboard.green.valuation).toBe(700)
  })
})

describe('news price impact', () => {
  const state = () => ({
    companies: { acme: { id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 100 } },
    prices: { acme: { price: 110, updatedAtMillis: 1_000, runtime: { mode: 'PHASE' as const, phaseId: 'p1', startPrice: 100, endPrice: 120, startAtMillis: 0, endAtMillis: 60_000, seed: 0 } } },
  })

  // Expectations go through clampToBounds because that is what bounds a price;
  // asserting bare arithmetic would silently disagree with pricingCore.
  it('shifts the whole phase runtime so the shock survives the next tick', () => {
    const next = state()
    applyNewsImpact(next, 10, 2_000)
    expect(next.prices.acme.runtime!.startPrice).toBe(clampToBounds(110, 100))
    expect(next.prices.acme.runtime!.endPrice).toBe(clampToBounds(132, 100))
    // entry.price is derived from the shifted runtime, not clamped independently,
    // so it is by construction the number the next tick recomputes.
    expect(next.prices.acme.price).toBe(clampToBounds(110 + (132 - 110) * (2_000 / 60_000), 100))
    expect(next.prices.acme.updatedAtMillis).toBe(2_000)
  })

  it('clamps the impact and keeps the price inside the base-price bounds', () => {
    const next = state()
    applyNewsImpact(next, -500, 2_000)
    const shiftedStart = clampToBounds(100 * 0.8, 100)
    const shiftedEnd = clampToBounds(120 * 0.8, 100)
    expect(next.prices.acme.price).toBe(clampToBounds(shiftedStart + (shiftedEnd - shiftedStart) * (2_000 / 60_000), 100))
  })

  it('does nothing at zero', () => {
    const next = state()
    applyNewsImpact(next, 0, 2_000)
    expect(next.prices.acme.price).toBe(110)
  })

  it('sets a price the very next tick recomputes identically, so there is no twitch', () => {
    const next = state()
    applyNewsImpact(next, 10, 2_000)
    const runtime = next.prices.acme.runtime!
    expect(priceAtRuntime(runtime, 100, 2_000)).toBe(next.prices.acme.price)
  })

  it('keeps carrying the shock a second later, unlike an un-shocked runtime at the same instant', () => {
    const shocked = state()
    applyNewsImpact(shocked, 10, 2_000)
    const unshocked = state()
    const shockedNext = priceAtRuntime(shocked.prices.acme.runtime!, 100, 3_000)
    const unshockedNext = priceAtRuntime(unshocked.prices.acme.runtime!, 100, 3_000)
    const runtime = shocked.prices.acme.runtime!
    expect(shockedNext).toBe(clampToBounds(runtime.startPrice + (runtime.endPrice - runtime.startPrice) * (3_000 / 60_000), 100))
    expect(shockedNext).toBeGreaterThan(unshockedNext)
  })

  it('still shifts and clamps the price for an entry with no runtime', () => {
    const next = { companies: state().companies, prices: { acme: { price: 110, updatedAtMillis: 1_000 } } }
    applyNewsImpact(next, 10, 2_000)
    expect(next.prices.acme.price).toBe(clampToBounds(121, 100))
    expect(next.prices.acme.updatedAtMillis).toBe(2_000)
  })
})

describe('lease-specific disconnect markers', () => {
  it('does not let old connection A pause same-owner lease L2 after L1 was replaced', () => {
    const state: LiveMarketState = { meta: { ownerUid: 'teacher', capacity: 80, visibility: 'private', status: 'OPEN', createdAtMillis: 1, startingCash: 10000, joinCode: 'ABC123' }, teams: {}, hostLease: { ownerUid: 'teacher', leaseId: 'L2', expiresAtMillis: 2_000, paused: false }, hostDisconnects: { L1: { ownerUid: 'teacher', disconnectedAtMillis: 2 } } }
    expect(shouldPauseLease(state, 'teacher', 'L1', 100)).toBe(false)
    expect(shouldPauseLease(state, 'teacher', 'L2', 100)).toBe(false)
    state.hostDisconnects!.L2 = { ownerUid: 'teacher', disconnectedAtMillis: 3 }
    expect(shouldPauseLease(state, 'teacher', 'L2', 100)).toBe(true)
  })
})

describe('manual market pause', () => {
  const openState = (): LiveMarketState => ({
    meta: { ownerUid: 'teacher', capacity: 80, visibility: 'private', status: 'OPEN', createdAtMillis: 1, startingCash: 10000, joinCode: 'ABC234', openedAtMillis: 5_000 },
    teams: {},
    hostLease: { ownerUid: 'teacher', leaseId: 'L1', expiresAtMillis: 100_000, paused: false },
  })

  it('moves an open market to PAUSED and stamps pausedAtMillis', () => {
    const next = applyPauseMarket(openState(), 'teacher', 'L1', 20_000)!
    expect(next.meta.status).toBe('PAUSED')
    expect(next.meta.pausedAtMillis).toBe(20_000)
  })

  it('refuses when the market is not OPEN', () => {
    const state = openState()
    state.meta.status = 'SETUP'
    expect(applyPauseMarket(state, 'teacher', 'L1', 20_000)).toBeUndefined()
  })

  it('refuses without a valid lease', () => {
    expect(applyPauseMarket(openState(), 'teacher', 'WRONG', 20_000)).toBeUndefined()
  })

  it('refuses for a different owner', () => {
    expect(applyPauseMarket(openState(), 'someone-else', 'L1', 20_000)).toBeUndefined()
  })
})

describe('market company validation', () => {
  const companies = () => [{ id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 100 }]

  it('accepts a well-formed company list', () => {
    expect(validateMarketCompanies(companies())).toEqual([])
  })

  it('requires at least one company', () => {
    expect(validateMarketCompanies([])).toEqual(['銘柄は1件以上必要です。'])
  })

  it('rejects duplicate symbols', () => {
    const list = [...companies(), { id: 'acme2', name: 'Acme 2', symbol: 'ac', basePrice: 200 }]
    expect(validateMarketCompanies(list)).toContain('銘柄コードは重複できません。')
  })

  it('rejects a non-positive base price', () => {
    expect(validateMarketCompanies([{ id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 0 }])).toContain('基準価格は1〜1,000万円の整数で入力してください。')
  })
})

describe('market company edits', () => {
  const pausedState = (): LiveMarketState => ({
    meta: { ownerUid: 'teacher', capacity: 80, visibility: 'private', status: 'PAUSED', createdAtMillis: 1, startingCash: 10000, joinCode: 'ABC234' },
    teams: {},
    companies: { acme: { id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 100 } },
  })

  it('overwrites the companies map while the market is paused', () => {
    const next = applyUpdateMarketCompanies(pausedState(), 'teacher', 30_000, [{ id: 'acme', name: 'Updated Co', symbol: 'up', basePrice: 250 }])!
    expect(next.companies!.acme).toEqual({ id: 'acme', name: 'Updated Co', symbol: 'UP', basePrice: 250 })
  })

  it('refuses while the market is open', () => {
    const state = pausedState()
    state.meta.status = 'OPEN'
    expect(applyUpdateMarketCompanies(state, 'teacher', 30_000, [{ id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 100 }])).toBeUndefined()
  })

  it('refuses invalid company data even while paused', () => {
    expect(applyUpdateMarketCompanies(pausedState(), 'teacher', 30_000, [])).toBeUndefined()
  })

  it('refuses for a different owner', () => {
    expect(applyUpdateMarketCompanies(pausedState(), 'someone-else', 30_000, [{ id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 100 }])).toBeUndefined()
  })

  it('refuses while the market is ending or ended', () => {
    const ending = pausedState(); ending.meta.status = 'ENDING'
    expect(applyUpdateMarketCompanies(ending, 'teacher', 30_000, [{ id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 100 }])).toBeUndefined()
    const ended = pausedState(); ended.meta.status = 'ENDED'
    expect(applyUpdateMarketCompanies(ended, 'teacher', 30_000, [{ id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 100 }])).toBeUndefined()
  })

  it('clears the cached price runtime for an edited company, so the edit takes effect instead of being masked by the stale runtime', () => {
    const state = pausedState()
    state.prices = { acme: { price: 150, updatedAtMillis: 1, runtime: { mode: 'PHASE', phaseId: 'old-phase', startPrice: 100, endPrice: 150, startAtMillis: 0, endAtMillis: 999_999, seed: 0 } } }
    const next = applyUpdateMarketCompanies(state, 'teacher', 30_000, [{ id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 500 }])!
    expect(next.prices!.acme.runtime).toBeUndefined()
    expect(next.prices!.acme.price).toBe(150)
  })

  it('does nothing to prices when the edited company has no cached price yet', () => {
    const state = pausedState()
    expect(() => applyUpdateMarketCompanies(state, 'teacher', 30_000, [{ id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 500 }])).not.toThrow()
  })
})

describe('deriving the price engine input from live company data', () => {
  it('reflects an edited base price and phases, not template defaults', () => {
    const state: LiveMarketState = {
      meta: { ownerUid: 'teacher', capacity: 80, visibility: 'private', status: 'PAUSED', createdAtMillis: 1, startingCash: 10000, joinCode: 'ABC234' },
      teams: {},
      companies: { acme: { id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 100 } },
    }
    const edited = applyUpdateMarketCompanies(state, 'teacher', 1_000, [{ id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 777, phases: [{ id: 'p1', startMinute: 0, endMinute: 30, direction: 'DOWN', changePercent: 15 }] }])!
    const stocks = deriveStocksFromCompanies(edited.companies)
    expect(stocks).toEqual([{ id: 'acme', basePrice: 777, phases: [{ id: 'p1', startMinute: 0, endMinute: 30, direction: 'DOWN', changePercent: 15 }] }])
  })

  it('is empty when there are no companies yet', () => {
    expect(deriveStocksFromCompanies(undefined)).toEqual([])
    expect(deriveStocksFromCompanies({})).toEqual([])
  })
})

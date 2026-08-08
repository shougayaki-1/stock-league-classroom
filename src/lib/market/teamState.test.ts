import { describe, expect, it } from 'vitest'
import { createEmptyTeamState } from './teamState'

describe('createEmptyTeamState', () => {
  it('builds a zeroed LessonRunTeamState with the given starting cash and timestamp', () => {
    const state = createEmptyTeamState({ updatedAtMillis: 1000, cash: 100000 })
    expect(state).toEqual({
      cash: 100000,
      holdings: {},
      lockedBuyValue: 0,
      lockedSellQuantity: {},
      myOrders: [],
      updatedAtMillis: 1000,
    })
  })

  it('never includes another team\'s data — it is a pure, self-contained factory with no external reads', () => {
    const state = createEmptyTeamState({ updatedAtMillis: 1, cash: 0 })
    expect(Object.keys(state)).toEqual(['cash', 'holdings', 'lockedBuyValue', 'lockedSellQuantity', 'myOrders', 'updatedAtMillis'])
  })
})

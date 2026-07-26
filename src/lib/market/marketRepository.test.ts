import { describe, expect, it } from 'vitest'
import { participantId } from './liveMarketTypes'
import { initialLiveState } from './marketRepository'

describe('market identity', () => {
  it('keeps each device session distinct for a student', () => {
    expect(participantId('student', 'a')).toBe('student_a')
    expect(participantId('student', 'b')).not.toBe(participantId('student', 'a'))
  })

  it('copies immutable starting cash and configured price phases into live market state', () => {
    const state = initialLiveState({ ownerUid: 'teacher', visibility: 'private', joinCode: 'ABC234', template: { title: 't', description: '', startingCash: 5000, teams: [{ id: 'red', name: '赤' }, { id: 'blue', name: '青' }], companies: [{ id: 'acme', name: 'Acme', symbol: 'AC', initialPrice: 100, initialShares: 1, pricePhases: [{ id: 'up', startMinute: 0, endMinute: 60, direction: 'UP', changePercent: 10 }] }] } })
    expect(state.meta.startingCash).toBe(5000)
    expect(state.companies.acme.phases?.[0].direction).toBe('UP')
    expect(state.teamPortfolios.red.cash).toBe(5000)
  })
})

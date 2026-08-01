import { describe, expect, it } from 'vitest'
import { participantId } from './liveMarketTypes'
import type { LiveMarketState } from './liveMarketTypes'
import { applyReassignTeam, applyRemoveParticipant, initialLiveState } from './marketRepository'

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

const stateWithTwo = (): LiveMarketState => ({
  meta: { ownerUid: 'teacher', capacity: 80, visibility: 'private', status: 'OPEN', createdAtMillis: 1, startingCash: 10000, joinCode: 'ABC234' },
  teams: { red: { id: 'red', name: '赤' }, blue: { id: 'blue', name: '青' } },
  members: { u1: { teamId: 'red' }, u2: { teamId: 'red' } },
  participants: {
    u1_s: { uid: 'u1', sessionId: 's', displayName: 'A', teamId: 'red', connected: true, lastSeenAtMillis: 1 },
    u2_s: { uid: 'u2', sessionId: 's', displayName: 'B', teamId: 'red', connected: true, lastSeenAtMillis: 1 },
  },
  orders: { u1_s: { pending: { orderId: 'o1', stockId: 'acme', side: 'BUY', quantity: 1, submittedAtMillis: 1 } } },
  teamPortfolios: { red: { cash: 10000, holdings: {}, updatedAtMillis: 1 } },
  recoveryCodes: { AB23: { participantId: 'u1_s', teamId: 'red', displayName: 'A' } },
})

describe('participant removal', () => {
  it('drops the participant, their pending order, membership and recovery code', () => {
    const next = applyRemoveParticipant(stateWithTwo(), 'u1_s')!
    expect(next.participants!.u1_s).toBeUndefined()
    expect(next.participants!.u2_s).toBeDefined()
    expect(next.orders!.u1_s).toBeUndefined()
    expect(next.members!.u1).toBeUndefined()
    expect(next.recoveryCodes!.AB23).toBeUndefined()
    // Team assets are shared, so removing one member never touches the portfolio.
    expect(next.teamPortfolios!.red.cash).toBe(10000)
  })

  it('aborts when the participant does not exist', () => {
    expect(applyRemoveParticipant(stateWithTwo(), 'missing_s')).toBeUndefined()
  })
})

describe('team reassignment', () => {
  it('moves the participant, their membership and their recovery code to the new team', () => {
    const next = applyReassignTeam(stateWithTwo(), 'u1_s', 'blue', 99)!
    expect(next.participants!.u1_s.teamId).toBe('blue')
    expect(next.members!.u1.teamId).toBe('blue')
    expect(next.recoveryCodes!.AB23.teamId).toBe('blue')
    expect(next.teamPortfolios!.blue).toEqual({ cash: 10000, holdings: {}, updatedAtMillis: 99 })
  })

  it('aborts for an unknown team or a no-op move', () => {
    expect(applyReassignTeam(stateWithTwo(), 'u1_s', 'green', 99)).toBeUndefined()
    expect(applyReassignTeam(stateWithTwo(), 'u1_s', 'red', 99)).toBeUndefined()
  })
})

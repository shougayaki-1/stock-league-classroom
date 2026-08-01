import { describe, expect, it } from 'vitest'
import { participantId } from './liveMarketTypes'
import type { LiveMarketState } from './liveMarketTypes'
import { applyApproveJoinRequest, applyReassignTeam, applyRemoveParticipant, generateRecoveryCode, initialLiveState } from './marketRepository'

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

const pendingState = (recoveryCode?: string): LiveMarketState => ({
  meta: { ownerUid: 'teacher', capacity: 80, visibility: 'private', status: 'OPEN', createdAtMillis: 1, startingCash: 10000, joinCode: 'ABC234' },
  teams: { red: { id: 'red', name: '赤' }, blue: { id: 'blue', name: '青' } },
  joinRequests: { new_s2: { uid: 'new', sessionId: 's2', displayName: 'A', requestedTeamId: null, connected: true, requestedAtMillis: 5, ...(recoveryCode ? { recoveryCode } : {}) } },
  participants: { old_s1: { uid: 'old', sessionId: 's1', displayName: 'A', teamId: 'blue', connected: false, lastSeenAtMillis: 1 } },
  members: { old: { teamId: 'blue' } },
  transactions: { old_s1: { o1: { orderId: 'o1', participantId: 'old_s1', teamId: 'blue', stockId: 'acme', side: 'BUY', requestedQuantity: 2, filledQuantity: 2, price: 100, processedAtMillis: 6 } } },
  teamPortfolios: { blue: { cash: 9800, holdings: { acme: 2 }, updatedAtMillis: 6 } },
  recoveryCodes: { AB23: { participantId: 'old_s1', teamId: 'blue', displayName: 'A' } },
})

describe('recovery codes', () => {
  it('issues a code on a first approval and records the reverse index', () => {
    const state = pendingState()
    delete state.recoveryCodes
    delete state.participants
    const next = applyApproveJoinRequest(state, 'new_s2', 'random', undefined, 99, 'ZZ99')!
    expect(next.joinRequests!.new_s2.recoveryCode).toBe('ZZ99')
    expect(next.recoveryCodes!.ZZ99).toEqual({ participantId: 'new_s2', teamId: next.participants!.new_s2.teamId, displayName: 'A' })
  })

  it('restores the previous team and trade history when a code is presented', () => {
    const next = applyApproveJoinRequest(pendingState('AB23'), 'new_s2', 'random', undefined, 99, 'ZZ99')!
    expect(next.participants!.new_s2.teamId).toBe('blue')
    expect(next.participants!.old_s1).toBeUndefined()
    expect(next.transactions!.new_s2.o1.filledQuantity).toBe(2)
    expect(next.transactions!.old_s1).toBeUndefined()
    expect(next.recoveryCodes!.AB23.participantId).toBe('new_s2')
    expect(next.joinRequests!.new_s2.recoveryCode).toBe('AB23')
    // The team keeps every asset, so the student comes back to exactly what they left.
    expect(next.teamPortfolios!.blue).toEqual({ cash: 9800, holdings: { acme: 2 }, updatedAtMillis: 6 })
  })

  it('ignores an unknown code and assigns a team normally', () => {
    const next = applyApproveJoinRequest(pendingState('QQQQ'), 'new_s2', 'random', undefined, 99, 'ZZ99')!
    expect(next.joinRequests!.new_s2.recoveryCode).toBe('ZZ99')
    expect(next.participants!.old_s1).toBeDefined()
  })

  it('refuses a new participant once the capacity is reached', () => {
    const state = pendingState()
    state.meta.capacity = 1
    state.participants!.old_s1.connected = true
    expect(applyApproveJoinRequest(state, 'new_s2', 'random', undefined, 99, 'ZZ99')).toBeUndefined()
  })

  it('generates a four character code from the unambiguous alphabet', () => {
    expect(generateRecoveryCode(new Uint32Array([0, 1, 2, 3]))).toBe('2345')
    expect(generateRecoveryCode()).toHaveLength(4)
  })

  it('rejects a forged recovery code whose display name does not match', () => {
    const state = pendingState('AB23')
    state.joinRequests!.new_s2.displayName = 'Mallory'
    const next = applyApproveJoinRequest(state, 'new_s2', 'random', undefined, 99, 'ZZ99')!
    // The requester still gets in, just onto a normally-assigned team with a fresh code.
    expect(next.participants!.new_s2.teamId).toBe('red')
    expect(next.joinRequests!.new_s2.recoveryCode).toBe('ZZ99')
    expect(next.recoveryCodes!.ZZ99).toEqual({ participantId: 'new_s2', teamId: 'red', displayName: 'Mallory' })
    // The victim keeps their seat, their history and their own recovery code.
    expect(next.participants!.old_s1).toBeDefined()
    expect(next.transactions!.old_s1).toBeDefined()
    expect(next.transactions!.new_s2).toBeUndefined()
    expect(next.recoveryCodes!.AB23).toEqual({ participantId: 'old_s1', teamId: 'blue', displayName: 'A' })
  })

  it('clears the stale old identity on a genuine recovery, so approval cannot ping-pong', () => {
    const state = pendingState('AB23')
    // Simulates the old tab being left open: its join request is still connected.
    state.joinRequests!.old_s1 = { uid: 'old', sessionId: 's1', displayName: 'A', requestedTeamId: null, connected: true, requestedAtMillis: 1, approvedAtMillis: 1, recoveryCode: 'AB23' }
    const next = applyApproveJoinRequest(state, 'new_s2', 'random', undefined, 99, 'ZZ99')!
    expect(next.participants!.new_s2.teamId).toBe('blue')
    expect(next.members!.old).toBeUndefined()
    expect(next.joinRequests!.old_s1).toBeUndefined()
  })

  it('matches a lowercase presented code', () => {
    const next = applyApproveJoinRequest(pendingState('ab23'), 'new_s2', 'random', undefined, 99, 'ZZ99')!
    expect(next.participants!.new_s2.teamId).toBe('blue')
    expect(next.recoveryCodes!.AB23.participantId).toBe('new_s2')
  })

  it('aborts when the freshly generated code already exists in recoveryCodes', () => {
    const state = pendingState()
    state.recoveryCodes = { ZZ99: { participantId: 'old_s1', teamId: 'blue', displayName: 'A' } }
    expect(applyApproveJoinRequest(state, 'new_s2', 'random', undefined, 99, 'ZZ99')).toBeUndefined()
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

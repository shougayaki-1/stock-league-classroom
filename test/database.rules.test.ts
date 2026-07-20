import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

const projectId = 'demo-stock-league-classroom'
let environment: RulesTestEnvironment
const market = 'market-a'
const seed = {
  meta: { ownerUid: 'teacher-a', capacity: 80, visibility: 'private', status: 'SETUP', createdAtMillis: 1, startingCash: 10000 },
  teams: { red: { id: 'red', name: '赤' } },
}

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId, database: { rules: readFileSync(join(process.cwd(), 'database.rules.json'), 'utf8') } })
})
beforeEach(async () => {
  await environment.clearDatabase()
  await environment.withSecurityRulesDisabled(async (context) => context.database().ref(`liveMarkets/${market}`).set(seed))
})
afterAll(async () => environment?.cleanup())

describe('live market RTDB rules', () => {
  it('allows only the owner to create participants and preserve immutable metadata', async () => {
    const owner = environment.authenticatedContext('teacher-a').database()
    const student = environment.authenticatedContext('student-a').database()
    await assertSucceeds(owner.ref(`liveMarkets/${market}/participants/student-a_session`).set({ uid: 'student-a', sessionId: 'session', displayName: '生徒', teamId: 'red', connected: true, lastSeenAtMillis: 1 }))
    await assertFails(student.ref(`liveMarkets/${market}/participants/student-a_session`).set({ uid: 'student-a' }))
    await assertFails(owner.ref(`liveMarkets/${market}/meta/capacity`).set(79))
  })

  it('uses node-specific reads instead of granting an authenticated market-root read', async () => {
    const student = environment.authenticatedContext('student-a').database()
    const owner = environment.authenticatedContext('teacher-a').database()
    await environment.withSecurityRulesDisabled(async (context) => context.database().ref(`liveMarkets/${market}/participants/student-a_session`).set({ uid: 'student-a', sessionId: 'session', displayName: '生徒', teamId: 'red', connected: true, lastSeenAtMillis: 1 }))
    await assertFails(student.ref(`liveMarkets/${market}`).once('value'))
    await assertSucceeds(student.ref(`liveMarkets/${market}/meta`).once('value'))
    await assertSucceeds(student.ref(`liveMarkets/${market}/teams`).once('value'))
    await assertSucceeds(student.ref(`liveMarkets/${market}/participants/student-a_session`).once('value'))
    await assertFails(environment.authenticatedContext('student-b').database().ref(`liveMarkets/${market}/participants/student-a_session`).once('value'))
    await assertSucceeds(owner.ref(`liveMarkets/${market}`).once('value'))
  })

  it('allows a student to create and disconnect only their own join request', async () => {
    const student = environment.authenticatedContext('student-a').database()
    const other = environment.authenticatedContext('student-b').database()
    const path = `liveMarkets/${market}/joinRequests/student-a_session`
    await assertSucceeds(student.ref(path).set({ uid: 'student-a', sessionId: 'session', displayName: '生徒', requestedTeamId: null, connected: true, requestedAtMillis: 1 }))
    await assertSucceeds(student.ref(`${path}/connected`).set(false))
    await assertFails(other.ref(path).update({ connected: true }))
    await assertFails(student.ref(path).update({ displayName: '改ざん' }))
  })

  it('rejects malformed or unbound join request writes even through child paths', async () => {
    const student = environment.authenticatedContext('student-a').database()
    const badId = `liveMarkets/${market}/joinRequests/not-the-session-id`
    await assertFails(student.ref(badId).set({ uid: 'student-a', sessionId: 'session', displayName: '生徒', requestedTeamId: null, connected: true, requestedAtMillis: 1 }))
    await assertFails(student.ref(`liveMarkets/${market}/joinRequests/student-a_session`).set({ uid: 'student-a', sessionId: 'session', displayName: 3, requestedTeamId: null, connected: true, requestedAtMillis: 1 }))
    await assertFails(student.ref(`liveMarkets/${market}/joinRequests/student-a_session/connected`).set('yes'))
  })

  it('allows an approved student to arm only their own participant connection lifecycle', async () => {
    const owner = environment.authenticatedContext('teacher-a').database()
    const student = environment.authenticatedContext('student-a').database()
    const path = `liveMarkets/${market}/participants/student-a_session`
    await assertSucceeds(owner.ref(path).set({ uid: 'student-a', sessionId: 'session', displayName: '生徒', teamId: 'red', connected: true, lastSeenAtMillis: 1 }))
    await assertSucceeds(student.ref(`${path}/connected`).set(false))
    await assertSucceeds(student.ref(`${path}/lastSeenAtMillis`).set(2))
    await assertFails(student.ref(path).update({ teamId: 'blue' }))
    await assertFails(environment.authenticatedContext('student-b').database().ref(`${path}/connected`).set(false))
  })

  it('allows a participant to submit one well-formed pending order but not mutate portfolios', async () => {
    const owner = environment.authenticatedContext('teacher-a').database()
    const student = environment.authenticatedContext('student-a').database()
    await assertSucceeds(owner.ref(`liveMarkets/${market}/participants/student-a_session`).set({ uid: 'student-a', sessionId: 'session', displayName: '生徒', teamId: 'red', connected: true, lastSeenAtMillis: 1 }))
    await assertFails(student.ref(`liveMarkets/${market}/orders/student-a_session/pending`).set({ orderId: 'closed', stockId: 'acme', side: 'BUY', quantity: 2, submittedAtMillis: 1 }))
    await assertSucceeds(owner.ref(`liveMarkets/${market}/meta/status`).set('OPEN'))
    const pending = `liveMarkets/${market}/orders/student-a_session/pending`
    await assertSucceeds(student.ref(pending).set({ orderId: 'once', stockId: 'acme', side: 'BUY', quantity: 2, submittedAtMillis: 2 }))
    await assertFails(student.ref(pending).set({ orderId: 'twice', stockId: 'acme', side: 'BUY', quantity: 2, submittedAtMillis: 3 }))
    await assertFails(student.ref(`liveMarkets/${market}/portfolios/student-a_session`).set({ cash: 0, holdings: {}, updatedAtMillis: 1 }))
  })

  it('exposes portfolios to any authenticated student only when the market is public', async () => {
    const publicMarket = 'market-public'
    await environment.withSecurityRulesDisabled(async (context) =>
      context.database().ref(`liveMarkets/${publicMarket}`).set({
        meta: { ownerUid: 'teacher-a', capacity: 80, visibility: 'public', status: 'SETUP', createdAtMillis: 1, startingCash: 10000 },
        teams: { red: { id: 'red', name: '赤' } },
        portfolios: { 'student-a_session': { cash: 100, holdings: {}, updatedAtMillis: 1 } },
      })
    )
    const other = environment.authenticatedContext('student-b').database()
    await assertSucceeds(other.ref(`liveMarkets/${publicMarket}/portfolios/student-a_session`).once('value'))
  })

  it('does not expose another participant portfolio when the market is private (regression guard)', async () => {
    await environment.withSecurityRulesDisabled(async (context) =>
      context.database().ref(`liveMarkets/${market}/portfolios/student-a_session`).set({ cash: 100, holdings: {}, updatedAtMillis: 1 })
    )
    const other = environment.authenticatedContext('student-b').database()
    await assertFails(other.ref(`liveMarkets/${market}/portfolios/student-a_session`).once('value'))
  })

  it('does not expose raw portfolios to other students when the market is ranking_only', async () => {
    const rankingMarket = 'market-ranking'
    await environment.withSecurityRulesDisabled(async (context) =>
      context.database().ref(`liveMarkets/${rankingMarket}`).set({
        meta: { ownerUid: 'teacher-a', capacity: 80, visibility: 'ranking_only', status: 'SETUP', createdAtMillis: 1, startingCash: 10000 },
        teams: { red: { id: 'red', name: '赤' } },
        portfolios: { 'student-a_session': { cash: 100, holdings: {}, updatedAtMillis: 1 } },
      })
    )
    const other = environment.authenticatedContext('student-b').database()
    await assertFails(other.ref(`liveMarkets/${rankingMarket}/portfolios/student-a_session`).once('value'))
  })

  // liveMarkets/{marketId}/leaderboard is a separate node from the signage node's own
  // leaderboard array (src/lib/market/signageWriter.ts) — this one is keyed by participantId
  // and includes rank, for authenticated students viewing ranking_only/public markets directly;
  // the signage one is an unranked array for the public display. No producer writes this node yet.
  it('allows any authenticated student to read the leaderboard when the market is ranking_only', async () => {
    const rankingMarket = 'market-ranking'
    await environment.withSecurityRulesDisabled(async (context) =>
      context.database().ref(`liveMarkets/${rankingMarket}`).set({
        meta: { ownerUid: 'teacher-a', capacity: 80, visibility: 'ranking_only', status: 'SETUP', createdAtMillis: 1, startingCash: 10000 },
        teams: { red: { id: 'red', name: '赤' } },
        leaderboard: { p1: { name: 'A', rank: 1, valuation: 1000 } },
      })
    )
    const other = environment.authenticatedContext('student-b').database()
    await assertSucceeds(other.ref(`liveMarkets/${rankingMarket}/leaderboard`).once('value'))
  })

  it('does not expose the leaderboard to non-owner students when the market is private', async () => {
    await environment.withSecurityRulesDisabled(async (context) =>
      context.database().ref(`liveMarkets/${market}/leaderboard`).set({ p1: { name: 'A', rank: 1, valuation: 1000 } })
    )
    const other = environment.authenticatedContext('student-b').database()
    await assertFails(other.ref(`liveMarkets/${market}/leaderboard`).once('value'))
  })

  it('always allows the market owner to read the leaderboard regardless of visibility', async () => {
    await environment.withSecurityRulesDisabled(async (context) =>
      context.database().ref(`liveMarkets/${market}/leaderboard`).set({ p1: { name: 'A', rank: 1, valuation: 1000 } })
    )
    const owner = environment.authenticatedContext('teacher-a').database()
    await assertSucceeds(owner.ref(`liveMarkets/${market}/leaderboard`).once('value'))
  })
})

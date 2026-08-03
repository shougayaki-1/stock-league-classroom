import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

const projectId = 'demo-stock-league-classroom'
const market = 'market-a'
const teacherToken = { email_verified: true, firebase: { sign_in_provider: 'google.com' as const } }
let environment: RulesTestEnvironment
const seed = {
  meta: { ownerUid: 'teacher-a', capacity: 80, visibility: 'private', status: 'SETUP', createdAtMillis: 1, startingCash: 10000, joinCode: 'ABC123' },
  teams: { red: { id: 'red', name: '赤' }, blue: { id: 'blue', name: '青' } },
  companies: { acme: { id: 'acme', name: 'Acme', symbol: 'ACME', basePrice: 100 } },
  teamPortfolios: { red: { cash: 10000, holdings: {}, updatedAtMillis: 1 }, blue: { cash: 10000, holdings: {}, updatedAtMillis: 1 } },
}

const approveStudent = async (uid = 'student-a', teamId = 'red') => {
  await environment.withSecurityRulesDisabled(async (context) => context.database().ref(`liveMarkets/${market}`).update({
    [`members/${uid}`]: { teamId },
    [`participants/${uid}_session`]: { uid, sessionId: 'session', displayName: '生徒', teamId, connected: true, lastSeenAtMillis: 1 },
  }))
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
  it('allows verified Google teachers, but not anonymous students, to create markets', async () => {
    const teacher = environment.authenticatedContext('teacher-b', teacherToken).database()
    const student = environment.authenticatedContext('student-a', { firebase: { sign_in_provider: 'anonymous' as const } }).database()
    await assertSucceeds(teacher.ref('liveMarkets/market-b').set({ ...seed, meta: { ...seed.meta, ownerUid: 'teacher-b' } }))
    await assertFails(student.ref('liveMarkets/forged').set({ ...seed, meta: { ...seed.meta, ownerUid: 'student-a' } }))
  })

  it('separates approved members from outsiders for shared market data', async () => {
    await approveStudent()
    const member = environment.authenticatedContext('student-a').database()
    const outsider = environment.authenticatedContext('student-b').database()
    await assertSucceeds(member.ref(`liveMarkets/${market}/meta`).once('value'))
    await assertSucceeds(member.ref(`liveMarkets/${market}/teams`).once('value'))
    await assertSucceeds(member.ref(`liveMarkets/${market}/companies`).once('value'))
    await assertFails(outsider.ref(`liveMarkets/${market}/meta`).once('value'))
    await assertFails(outsider.ref(`liveMarkets/${market}/prices`).once('value'))
  })

  it('allows a student to create a join request during setup, and still after the market opens', async () => {
    const student = environment.authenticatedContext('student-a').database()
    const path = `liveMarkets/${market}/joinRequests/student-a_session`
    await assertSucceeds(student.ref(path).set({ uid: 'student-a', sessionId: 'session', displayName: '生徒', requestedTeamId: null, connected: true, requestedAtMillis: 1 }))
    await assertSucceeds(student.ref(`${path}/connected`).set(false))
    const teacher = environment.authenticatedContext('teacher-a', teacherToken).database()
    await assertSucceeds(teacher.ref(`liveMarkets/${market}/meta/status`).set('OPEN'))
    await assertSucceeds(environment.authenticatedContext('student-b').database().ref(`liveMarkets/${market}/joinRequests/student-b_session`).set({ uid: 'student-b', sessionId: 'session', displayName: '遅刻', requestedTeamId: null, connected: true, requestedAtMillis: 2 }))
  })

  it('rejects malformed and identity-changing join request writes through child paths', async () => {
    const student = environment.authenticatedContext('student-a').database()
    const path = `liveMarkets/${market}/joinRequests/student-a_session`
    await assertFails(student.ref(`liveMarkets/${market}/joinRequests/unbound`).set({ uid: 'student-a', sessionId: 'session', displayName: '生徒', requestedTeamId: null, connected: true, requestedAtMillis: 1 }))
    await assertFails(student.ref(path).set({ uid: 'student-a', sessionId: 'session', displayName: 3, requestedTeamId: null, connected: true, requestedAtMillis: 1 }))
    await assertSucceeds(student.ref(path).set({ uid: 'student-a', sessionId: 'session', displayName: '生徒', requestedTeamId: null, connected: true, requestedAtMillis: 1 }))
    await assertFails(student.ref(`${path}/displayName`).set('改ざん'))
    await assertFails(student.ref(`${path}/approvedAtMillis`).set(2))
    await assertFails(student.ref(`${path}/connected`).set('yes'))
  })

  it('lets a pending student re-mark their own join request connected across a reconnect', async () => {
    const student = environment.authenticatedContext('student-a').database()
    const path = `liveMarkets/${market}/joinRequests/student-a_session`
    await assertSucceeds(student.ref(path).set({ uid: 'student-a', sessionId: 'session', displayName: '生徒', requestedTeamId: null, connected: true, requestedAtMillis: 1 }))
    await assertSucceeds(student.ref(`${path}/connected`).set(false))
    // Mirrors armJoinRequestPresence: a multi-field update re-marking connected and
    // lastSeenAtMillis together, exactly as re-armed on every reconnect.
    await assertSucceeds(student.ref(path).update({ connected: true, lastSeenAtMillis: 2 }))
    await assertFails(student.ref(path).update({ displayName: '改ざん', connected: true, lastSeenAtMillis: 2 }))
    await assertFails(environment.authenticatedContext('student-b').database().ref(path).update({ connected: true, lastSeenAtMillis: 2 }))
  })

  it('allows an approved student to update only their presence', async () => {
    await approveStudent()
    const student = environment.authenticatedContext('student-a').database()
    const path = `liveMarkets/${market}/participants/student-a_session`
    await assertSucceeds(student.ref(`${path}/connected`).set(false))
    await assertSucceeds(student.ref(`${path}/lastSeenAtMillis`).set(2))
    await assertFails(student.ref(path).update({ teamId: 'blue' }))
    await assertFails(environment.authenticatedContext('student-b').database().ref(`${path}/connected`).set(false))
  })

  it('accepts one bounded integer order and rejects malformed quantities', async () => {
    await approveStudent()
    const teacher = environment.authenticatedContext('teacher-a', teacherToken).database()
    await assertSucceeds(teacher.ref(`liveMarkets/${market}/meta/status`).set('OPEN'))
    const student = environment.authenticatedContext('student-a').database()
    const pending = student.ref(`liveMarkets/${market}/orders/student-a_session/pending`)
    await assertSucceeds(pending.set({ orderId: 'once', stockId: 'acme', side: 'BUY', quantity: 2, submittedAtMillis: 2 }))
    await assertFails(pending.set({ orderId: 'twice', stockId: 'acme', side: 'BUY', quantity: 2, submittedAtMillis: 3 }))
    await environment.withSecurityRulesDisabled(async (context) => context.database().ref(`liveMarkets/${market}/orders/student-a_session/pending`).remove())
    await assertFails(pending.set({ orderId: 'fraction', stockId: 'acme', side: 'BUY', quantity: 1.5, submittedAtMillis: 3 }))
    await assertFails(pending.set({ orderId: 'huge', stockId: 'acme', side: 'BUY', quantity: 100001, submittedAtMillis: 3 }))
  })

  it('lets members read only their own team account', async () => {
    await approveStudent()
    const member = environment.authenticatedContext('student-a').database()
    await assertSucceeds(member.ref(`liveMarkets/${market}/teamPortfolios/red`).once('value'))
    await assertFails(member.ref(`liveMarkets/${market}/teamPortfolios/blue`).once('value'))
    await assertFails(environment.authenticatedContext('student-b').database().ref(`liveMarkets/${market}/teamPortfolios/red`).once('value'))
  })

  it('exposes only the pre-aggregated signage projection for ranking/public markets', async () => {
    await environment.withSecurityRulesDisabled(async (context) => context.database().ref(`liveMarkets/${market}`).update({
      'meta/visibility': 'ranking_only',
      signage: { prices: [], publicNews: [], phase: 'SETUP', leaderboard: [{ name: '赤', valuation: 10000, rank: 1 }] },
      teamLeaderboard: { red: { teamId: 'red', name: '赤', valuation: 10000, rank: 1 } },
    }))
    const outsider = environment.authenticatedContext('student-b').database()
    await assertSucceeds(outsider.ref(`liveMarkets/${market}/signage`).once('value'))
    await assertFails(outsider.ref(`liveMarkets/${market}/teamLeaderboard`).once('value'))
    await assertFails(outsider.ref(`liveMarkets/${market}/teamPortfolios/red`).once('value'))
  })
})

describe('emergency stop (RTDB)', () => {
  const freshMarket = { meta: { ownerUid: 'teacher-a', capacity: 80, visibility: 'private', status: 'SETUP', createdAtMillis: 2, startingCash: 10000, joinCode: 'NEW123' } }
  const setSwitch = (acceptingNewMarkets: boolean) => environment.withSecurityRulesDisabled(async (context) =>
    context.database().ref('serviceStatus').set({ acceptingNewMarkets }))

  it('lets a teacher create a live market while the switch is absent or open', async () => {
    const teacher = environment.authenticatedContext('teacher-a', teacherToken).database()
    await assertSucceeds(teacher.ref('liveMarkets/no-switch').set(freshMarket))
    await setSwitch(true)
    await assertSucceeds(teacher.ref('liveMarkets/switch-open').set(freshMarket))
  })

  it('blocks a teacher from creating a live market directly once closed', async () => {
    await setSwitch(false)
    const teacher = environment.authenticatedContext('teacher-a', teacherToken).database()
    await assertFails(teacher.ref('liveMarkets/blocked').set(freshMarket))
  })

  it('keeps an in-progress market writable so a running lesson is not cut off', async () => {
    await setSwitch(false)
    const teacher = environment.authenticatedContext('teacher-a', teacherToken).database()
    await assertSucceeds(teacher.ref(`liveMarkets/${market}/meta/status`).set('OPEN'))
  })

  it('lets clients read the switch but only an operator flip it', async () => {
    await setSwitch(false)
    const student = environment.authenticatedContext('student-a', { firebase: { sign_in_provider: 'anonymous' as const } }).database()
    await assertSucceeds(student.ref('serviceStatus').get())
    await assertFails(student.ref('serviceStatus').set({ acceptingNewMarkets: true }))
    // An ordinary teacher must not be able to reopen the service for themselves.
    await assertFails(environment.authenticatedContext('teacher-a', teacherToken).database().ref('serviceStatus').set({ acceptingNewMarkets: true }))
    const operator = environment.authenticatedContext('operator-a', { ...teacherToken, operator: true }).database()
    await assertSucceeds(operator.ref('serviceStatus').set({ acceptingNewMarkets: true }))
    await assertFails(operator.ref('serviceStatus').set({ acceptingNewMarkets: 'yes' }))
  })
})

describe('recovery codes', () => {
  it('lets a student read but never rewrite the code issued to them', async () => {
    const request = { uid: 'student-a', sessionId: 'session', displayName: '生徒', requestedTeamId: null, connected: true, requestedAtMillis: 1, recoveryCode: 'AB23' }
    await environment.withSecurityRulesDisabled(async (context) =>
      context.database().ref(`liveMarkets/${market}/joinRequests/student-a_session`).set(request))
    const student = environment.authenticatedContext('student-a').database()
    await assertSucceeds(student.ref(`liveMarkets/${market}/joinRequests/student-a_session/recoveryCode`).get())
    await assertFails(student.ref(`liveMarkets/${market}/joinRequests/student-a_session`).set({ ...request, recoveryCode: 'ZZ99' }))
  })

  it('never exposes the market-wide recovery index to a student', async () => {
    await approveStudent()
    await environment.withSecurityRulesDisabled(async (context) =>
      context.database().ref(`liveMarkets/${market}/recoveryCodes/AB23`).set({ participantId: 'student-a_session', teamId: 'red', displayName: '生徒' }))
    await assertFails(environment.authenticatedContext('student-a').database().ref(`liveMarkets/${market}/recoveryCodes`).get())
  })

  it('rejects a malformed recovery code on a join request', async () => {
    const student = environment.authenticatedContext('student-b').database()
    await assertFails(student.ref(`liveMarkets/${market}/joinRequests/student-b_session`).set({
      uid: 'student-b', sessionId: 'session', displayName: '生徒', requestedTeamId: null, connected: true, requestedAtMillis: 1, recoveryCode: 'TOOLONG',
    }))
  })
})

describe('joining an already-open market', () => {
  it('accepts a join request while the market is OPEN but not after it ended', async () => {
    await environment.withSecurityRulesDisabled(async (context) =>
      context.database().ref(`liveMarkets/${market}/meta/status`).set('OPEN'))
    const student = environment.authenticatedContext('student-late').database()
    const request = { uid: 'student-late', sessionId: 'session', displayName: '遅刻', requestedTeamId: null, connected: true, requestedAtMillis: 5 }
    await assertSucceeds(student.ref(`liveMarkets/${market}/joinRequests/student-late_session`).set(request))

    await environment.withSecurityRulesDisabled(async (context) =>
      context.database().ref(`liveMarkets/${market}/meta/status`).set('ENDED'))
    const other = environment.authenticatedContext('student-too-late').database()
    await assertFails(other.ref(`liveMarkets/${market}/joinRequests/student-too-late_session`).set({ ...request, uid: 'student-too-late' }))
  })
})

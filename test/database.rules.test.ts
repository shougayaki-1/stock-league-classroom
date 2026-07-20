import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

const projectId = 'demo-stock-league-classroom'
let environment: RulesTestEnvironment
const market = 'market-a'
const seed = {
  meta: { ownerUid: 'teacher-a', capacity: 80, visibility: 'private', status: 'SETUP', createdAtMillis: 1 },
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

  it('allows a student to create and disconnect only their own join request', async () => {
    const student = environment.authenticatedContext('student-a').database()
    const other = environment.authenticatedContext('student-b').database()
    const path = `liveMarkets/${market}/joinRequests/student-a_session`
    await assertSucceeds(student.ref(path).set({ uid: 'student-a', sessionId: 'session', displayName: '生徒', requestedTeamId: null, connected: true, requestedAtMillis: 1 }))
    await assertSucceeds(student.ref(`${path}/connected`).set(false))
    await assertFails(other.ref(path).update({ connected: true }))
    await assertFails(student.ref(path).update({ displayName: '改ざん' }))
  })
})

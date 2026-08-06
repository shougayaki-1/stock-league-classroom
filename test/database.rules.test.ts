import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

const projectId = 'demo-stock-league-classroom'
const teacherToken = { email_verified: true, firebase: { sign_in_provider: 'google.com' as const } }
let environment: RulesTestEnvironment

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId, database: { rules: readFileSync(join(process.cwd(), 'database.rules.json'), 'utf8') } })
})
beforeEach(async () => environment.clearDatabase())
afterAll(async () => environment?.cleanup())

describe('emergency stop (RTDB)', () => {
  it('allows authenticated reads and only operators to write a valid status', async () => {
    await environment.withSecurityRulesDisabled(async (context) => context.database().ref('serviceStatus').set({ acceptingNewMarkets: false }))
    await assertSucceeds(environment.authenticatedContext('student-a').database().ref('serviceStatus').get())
    await assertFails(environment.unauthenticatedContext().database().ref('serviceStatus').get())
    await assertFails(environment.authenticatedContext('teacher-a').database().ref('serviceStatus').set({ acceptingNewMarkets: true }))
    await assertSucceeds(environment.authenticatedContext('operator-a', { operator: true }).database().ref('serviceStatus').set({ acceptingNewMarkets: true }))
    await assertFails(environment.authenticatedContext('operator-a', { operator: true }).database().ref('serviceStatus').set({ acceptingNewMarkets: 'yes' }))
  })
})

describe('removed legacy RTDB tree', () => {
  it('denies an authenticated read and write at an arbitrary liveMarkets child path', async () => {
    const legacyPath = environment.authenticatedContext('teacher-a', { operator: true }).database().ref('liveMarkets/legacy-market/private/runtime')

    await assertFails(legacyPath.get())
    await assertFails(legacyPath.set({ legacy: true }))
  })
})

describe('orgAccess mirror', () => {
  it('rejects a member client write to their own entry', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).database()

    await assertFails(owner.ref('orgAccess/personal_teacher-a/teacher-a').set({ role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 }))
  })

  it('lets a member read only their own mirrored entry', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.database().ref('orgAccess/personal_teacher-a/teacher-a').set({ role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 })
    })

    const owner = environment.authenticatedContext('teacher-a', teacherToken).database()
    const other = environment.authenticatedContext('teacher-b', teacherToken).database()

    await assertSucceeds(owner.ref('orgAccess/personal_teacher-a/teacher-a').get())
    await assertFails(other.ref('orgAccess/personal_teacher-a/teacher-a').get())
  })

  it('does not expose the membership-version metadata to a member client', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.database().ref('orgAccessMeta/personal_teacher-a/teacher-a').set({ membershipVersion: 1 })
    })

    const owner = environment.authenticatedContext('teacher-a', teacherToken).database()

    await assertFails(owner.ref('orgAccessMeta/personal_teacher-a/teacher-a').get())
    await assertFails(owner.ref('orgAccessMeta/personal_teacher-a/teacher-a').set({ membershipVersion: 2 }))
  })
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

const projectId = 'demo-stock-league-classroom'
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

  it('denies the removed liveMarkets tree', async () => {
    await assertFails(environment.authenticatedContext('teacher-a', { operator: true }).database().ref('liveMarkets/legacy-market').get())
  })
})

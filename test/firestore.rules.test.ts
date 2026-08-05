import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

const projectId = 'demo-stock-league-classroom'
const teacherToken = { email_verified: true, firebase: { sign_in_provider: 'google.com' as const } }
const operatorToken = { ...teacherToken, operator: true }
let environment: RulesTestEnvironment

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8') },
  })
})
beforeEach(async () => environment.clearFirestore())
afterAll(async () => environment?.cleanup())

describe('emergency stop', () => {
  it('lets anyone read the notice but only an operator write it', async () => {
    const notice = { acceptingNewMarkets: false, message: 'メンテナンス中です。' }
    await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'serviceStatus', 'global'), notice))
    await assertSucceeds(getDoc(doc(environment.unauthenticatedContext().firestore(), 'serviceStatus', 'global')))
    await assertFails(setDoc(doc(environment.authenticatedContext('teacher-a', teacherToken).firestore(), 'serviceStatus', 'global'), { acceptingNewMarkets: true }))
    await assertSucceeds(setDoc(doc(environment.authenticatedContext('operator-a', operatorToken).firestore(), 'serviceStatus', 'global'), { acceptingNewMarkets: true, message: '' }))
  })

  it('denies all removed legacy collections', async () => {
    const db = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertFails(getDoc(doc(db, 'markets', 'legacy-market')))
    await assertFails(getDoc(doc(db, 'templates', 'legacy-template')))
  })
})

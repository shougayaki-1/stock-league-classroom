import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

const projectId = 'demo-stock-league-classroom'
let environment: RulesTestEnvironment
const teacherToken = { email_verified: true, firebase: { sign_in_provider: 'password' as const } }
const operatorToken = { ...teacherToken, operator: true }
const template = { title: '私の市場', description: '説明', startingCash: 10000, companies: [], ownerUid: 'teacher-a', visibility: 'private' }

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8') },
  })
})
beforeEach(async () => {
  await environment.clearFirestore()
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'templates', 'owned'), template)
    await setDoc(doc(context.firestore(), 'templates', 'other'), { ...template, ownerUid: 'teacher-b' })
    await setDoc(doc(context.firestore(), 'officialTemplates', 'seed'), { ...template, visibility: 'official' })
    await setDoc(doc(context.firestore(), 'templateShares', 'capability'), {
      snapshot: { title: '固定コピー', description: '公開', startingCash: 10000, companies: [] }, createdByUid: 'teacher-a', createdAt: 1,
    })
  })
})
afterAll(async () => environment?.cleanup())

describe('template Firestore rules', () => {
  it('permits an owner to get and list only their personal templates', async () => {
    const db = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertSucceeds(getDoc(doc(db, 'templates', 'owned')))
    await assertSucceeds(getDocs(query(collection(db, 'templates'), where('ownerUid', '==', 'teacher-a'))))
    await assertFails(getDoc(doc(db, 'templates', 'other')))
    await assertFails(getDocs(collection(db, 'templates')))
  })

  it('does not let a teacher change personal-template ownership', async () => {
    const db = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertFails(setDoc(doc(db, 'templates', 'owned'), { ...template, ownerUid: 'teacher-b' }))
  })

  it('requires an operator to edit official templates', async () => {
    const teacher = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const operator = environment.authenticatedContext('operator', operatorToken).firestore()
    await assertSucceeds(getDocs(collection(teacher, 'officialTemplates')))
    await assertFails(setDoc(doc(teacher, 'officialTemplates', 'seed'), { ...template, visibility: 'official' }))
    await assertSucceeds(setDoc(doc(operator, 'officialTemplates', 'seed'), { ...template, visibility: 'official' }))
  })

  it('allows only direct teacher reads of immutable share snapshots', async () => {
    const db = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertSucceeds(getDoc(doc(db, 'templateShares', 'capability')))
    await assertFails(getDocs(collection(db, 'templateShares')))
    await assertFails(setDoc(doc(db, 'templateShares', 'capability'), { snapshot: {}, createdByUid: 'teacher-a' }))
  })

  it('permits only a teacher to create a snapshot-only share', async () => {
    const teacher = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const anonymous = environment.unauthenticatedContext().firestore()
    await assertSucceeds(setDoc(doc(teacher, 'templateShares', 'new-share'), { snapshot: { title: 'コピー', description: '', startingCash: 1, companies: [] }, createdByUid: 'teacher-a' }))
    await assertFails(setDoc(doc(anonymous, 'templateShares', 'claimed'), { snapshot: {}, createdByUid: 'teacher-a' }))
    await assertFails(setDoc(doc(teacher, 'templateShares', 'foreign-source'), { templateId: 'other', snapshot: {}, createdByUid: 'teacher-a' }))
    await assertFails(setDoc(doc(teacher, 'templateShares', 'forged-owner'), { snapshot: {}, createdByUid: 'teacher-b' }))
  })
})

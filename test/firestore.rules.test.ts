import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

const projectId = 'demo-stock-league-classroom'
let environment: RulesTestEnvironment
const teacherToken = { email_verified: true, firebase: { sign_in_provider: 'google.com' as const } }
const operatorToken = { ...teacherToken, operator: true }
const template = { title: '私の市場', description: '説明', startingCash: 10000, teams: [{ id: 'red', name: '赤' }, { id: 'blue', name: '青' }], companies: [], ownerUid: 'teacher-a', visibility: 'private' }

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
      snapshot: { title: '固定コピー', description: '公開', startingCash: 10000, teams: template.teams, companies: [] }, createdByUid: 'teacher-a', createdAt: 1,
    })
    await setDoc(doc(context.firestore(), 'markets', 'market-a'), { ownerUid: 'teacher-a', templateSnapshot: template, capacity: 80, visibility: 'private', joinCode: 'ABC123' })
    await setDoc(doc(context.firestore(), 'marketJoinCodes', 'ABC123'), { marketId: 'market-a', ownerUid: 'teacher-a' })
  })
})

describe('market Firestore rules', () => {
  it('allows only the owning teacher to access a market document', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const other = environment.authenticatedContext('teacher-b', teacherToken).firestore()
    await assertSucceeds(getDoc(doc(owner, 'markets', 'market-a')))
    await assertFails(getDoc(doc(other, 'markets', 'market-a')))
    await assertFails(getDocs(collection(other, 'markets')))
  })

  it('makes join codes direct-get-only for anonymous students', async () => {
    const student = environment.authenticatedContext('student-a', { firebase: { sign_in_provider: 'anonymous' as const } }).firestore()
    await assertSucceeds(getDoc(doc(student, 'marketJoinCodes', 'ABC123')))
    await assertFails(getDocs(collection(student, 'marketJoinCodes')))
  })

  it('lets a teacher create a code only for a market they own', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const other = environment.authenticatedContext('teacher-b', teacherToken).firestore()
    const batch = writeBatch(owner)
    batch.set(doc(owner, 'markets', 'market-owned'), { ownerUid: 'teacher-a', templateSnapshot: template, capacity: 80, visibility: 'private', joinCode: 'OWNED1', creationStatus: 'CREATING' })
    batch.set(doc(owner, 'marketJoinCodes', 'OWNED1'), { marketId: 'market-owned', ownerUid: 'teacher-a' })
    await assertSucceeds(batch.commit())
    await assertFails(setDoc(doc(other, 'marketJoinCodes', 'FORGED'), { marketId: 'market-a', ownerUid: 'teacher-b' }))
  })

  it('keeps old market ownership, capacity, and snapshot immutable during creation recovery', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertSucceeds(updateDoc(doc(owner, 'markets', 'market-a'), { creationStatus: 'READY' }))
    await assertFails(updateDoc(doc(owner, 'markets', 'market-a'), { ownerUid: 'teacher-b' }))
    await assertFails(updateDoc(doc(owner, 'markets', 'market-a'), { capacity: 79 }))
    await assertFails(updateDoc(doc(owner, 'markets', 'market-a'), { templateSnapshot: { changed: true } }))
    await assertSucceeds(deleteDoc(doc(owner, 'markets', 'market-a')))
  })

  it('prevents a non-owning teacher from deleting another teacher\'s market', async () => {
    const other = environment.authenticatedContext('teacher-b', teacherToken).firestore()
    await assertFails(deleteDoc(doc(other, 'markets', 'market-a')))
  })

  it('allows the owner to checkpoint results and only the matching student to read them', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const student = environment.authenticatedContext('student-a', { firebase: { sign_in_provider: 'anonymous' as const } }).firestore()
    const other = environment.authenticatedContext('student-b', { firebase: { sign_in_provider: 'anonymous' as const } }).firestore()
    const result = doc(owner, 'marketResults', 'market-a', 'participants', 'student-a_session')
    await assertSucceeds(setDoc(result, { ownerUid: 'teacher-a', participantId: 'student-a_session', participantUid: 'student-a', checkpointId: 'ending-1' }))
    await assertSucceeds(getDoc(doc(student, 'marketResults', 'market-a', 'participants', 'student-a_session')))
    await assertFails(getDoc(doc(other, 'marketResults', 'market-a', 'participants', 'student-a_session')))
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
    await assertSucceeds(setDoc(doc(teacher, 'templateShares', 'new-share'), { snapshot: { title: 'コピー', description: '', startingCash: 1, teams: template.teams, companies: [] }, createdByUid: 'teacher-a' }))
    await assertFails(setDoc(doc(anonymous, 'templateShares', 'claimed'), { snapshot: {}, createdByUid: 'teacher-a' }))
    await assertFails(setDoc(doc(teacher, 'templateShares', 'foreign-source'), { templateId: 'other', snapshot: {}, createdByUid: 'teacher-a' }))
    await assertFails(setDoc(doc(teacher, 'templateShares', 'forged-owner'), { snapshot: {}, createdByUid: 'teacher-b' }))
  })
})

describe('emergency stop', () => {
  const newMarket = { ownerUid: 'teacher-a', templateSnapshot: template, capacity: 80, visibility: 'private', joinCode: 'ZZZ999', creationStatus: 'CREATING' }
  const setSwitch = (acceptingNewMarkets: boolean) => environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'serviceStatus', 'global'), { acceptingNewMarkets, message: 'メンテナンス中です。' })
  })

  it('allows market creation while the switch is absent or open', async () => {
    const teacher = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    // Absent document must not take the service down when the rules are published first.
    await assertSucceeds(setDoc(doc(teacher, 'markets', 'no-switch'), newMarket))
    await setSwitch(true)
    await assertSucceeds(setDoc(doc(teacher, 'markets', 'switch-open'), newMarket))
  })

  it('blocks new markets for every teacher once the switch is closed', async () => {
    await setSwitch(false)
    await assertFails(setDoc(doc(environment.authenticatedContext('teacher-a', teacherToken).firestore(), 'markets', 'blocked-a'), newMarket))
    await assertFails(setDoc(doc(environment.authenticatedContext('teacher-b', teacherToken).firestore(), 'markets', 'blocked-b'), { ...newMarket, ownerUid: 'teacher-b' }))
    // Operators are subject to the same stop; it is a service switch, not a permission.
    await assertFails(setDoc(doc(environment.authenticatedContext('teacher-a', operatorToken).firestore(), 'markets', 'blocked-op'), newMarket))
  })

  it('keeps existing markets usable while new creation is stopped', async () => {
    await setSwitch(false)
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertSucceeds(getDoc(doc(owner, 'markets', 'market-a')))
    await assertSucceeds(updateDoc(doc(owner, 'markets', 'market-a'), { creationStatus: 'READY' }))
  })

  it('lets anyone read the notice but only an operator write it', async () => {
    await setSwitch(false)
    await assertSucceeds(getDoc(doc(environment.unauthenticatedContext().firestore(), 'serviceStatus', 'global')))
    await assertFails(setDoc(doc(environment.authenticatedContext('teacher-a', teacherToken).firestore(), 'serviceStatus', 'global'), { acceptingNewMarkets: true }))
    await assertSucceeds(setDoc(doc(environment.authenticatedContext('teacher-a', operatorToken).firestore(), 'serviceStatus', 'global'), { acceptingNewMarkets: true, message: '' }))
  })
})

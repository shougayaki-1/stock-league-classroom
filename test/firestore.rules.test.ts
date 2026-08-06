import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
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
    const legacyPaths = [
      ['templates', 'legacy-template'],
      ['officialTemplates', 'legacy-template'],
      ['templateShares', 'legacy-share'],
      ['markets', 'legacy-market'],
      ['marketJoinCodes', 'LEGACY'],
      ['marketResults', 'legacy-market', 'participants', 'legacy-participant'],
      ['marketResults', 'legacy-market', 'teams', 'legacy-team'],
    ] as const

    for (const path of legacyPaths) {
      const reference = doc(db, path.join('/'))
      await assertFails(getDoc(reference))
      await assertFails(setDoc(reference, { legacy: true }))
    }
  })

  it('denies all client read/write of the publish idempotency store', async () => {
    const db = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const reference = doc(db, 'lessonVersionPublishIdempotency', 'some-key')
    await assertFails(getDoc(reference))
    await assertFails(setDoc(reference, { versionId: 'v1' }))
  })
})

describe('organization membership Firestore rules', () => {
  it('lets an active member read their organization and own membership and user documents only', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'organizations', 'personal_teacher-a'), { type: 'personal', ownerUid: 'teacher-a' })
      await setDoc(doc(context.firestore(), 'organizations', 'personal_teacher-a', 'members', 'teacher-a'), { role: 'owner', status: 'active', membershipVersion: 1 })
      await setDoc(doc(context.firestore(), 'users', 'teacher-a'), { personalOrgId: 'personal_teacher-a' })
    })

    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const other = environment.authenticatedContext('teacher-b', teacherToken).firestore()

    await assertSucceeds(getDoc(doc(owner, 'organizations', 'personal_teacher-a')))
    await assertFails(getDoc(doc(other, 'organizations', 'personal_teacher-a')))
    await assertSucceeds(getDoc(doc(owner, 'organizations', 'personal_teacher-a', 'members', 'teacher-a')))
    await assertSucceeds(getDoc(doc(owner, 'users', 'teacher-a')))
  })

  it('rejects client writes to organizations, memberships, and user profiles', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()

    await assertFails(setDoc(doc(owner, 'organizations', 'personal_teacher-a'), { type: 'personal', ownerUid: 'teacher-a' }))
    await assertFails(setDoc(doc(owner, 'organizations', 'personal_teacher-a', 'members', 'teacher-a'), { role: 'owner', status: 'active', membershipVersion: 1 }))
    await assertFails(setDoc(doc(owner, 'users', 'teacher-a'), { personalOrgId: 'personal_teacher-a' }))
  })

  it('lets a suspended member read their own membership status', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'organizations', 'personal_teacher-a', 'members', 'teacher-a'), { role: 'owner', status: 'suspended', membershipVersion: 2 })
    })

    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()

    await assertSucceeds(getDoc(doc(owner, 'organizations', 'personal_teacher-a', 'members', 'teacher-a')))
  })
})

describe('orgId/createdByUid immutability on lessonTemplates', () => {
  beforeEach(async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'organizations', 'personal_teacher-a', 'members', 'teacher-a'), { role: 'owner', status: 'active', membershipVersion: 1 })
    })
  })

  it('rejects a template whose orgId does not match the deterministic personal org id', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertFails(setDoc(doc(owner, 'lessonTemplates', 'bad'), {
      orgId: 'personal_teacher-b', createdByUid: 'teacher-a', draft: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' },
      currentPublishedVersionId: null, status: 'DRAFT', visibility: 'PRIVATE',
    }))
  })

  it('rejects changing orgId or createdByUid on update', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const valid = { orgId: 'personal_teacher-a', createdByUid: 'teacher-a', draft: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' }, currentPublishedVersionId: null, status: 'DRAFT', visibility: 'PRIVATE' }
    await setDoc(doc(owner, 'lessonTemplates', 'immutable'), valid)
    await assertFails(updateDoc(doc(owner, 'lessonTemplates', 'immutable'), { orgId: 'personal_teacher-b' }))
    await assertFails(updateDoc(doc(owner, 'lessonTemplates', 'immutable'), { status: 'READY' }))
  })

  it('rejects updating an already-created version', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await setDoc(doc(owner, 'lessonTemplates', 't1'), { orgId: 'personal_teacher-a', createdByUid: 'teacher-a', draft: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' }, currentPublishedVersionId: null, status: 'DRAFT', visibility: 'PRIVATE' })
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'lessonTemplates', 't1', 'versions', 'v1'), { templateId: 't1', orgId: 'personal_teacher-a', schemaVersion: 1, content: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' }, createdByUid: 'teacher-a', changeSummary: '', immutable: true })
    })
    await assertFails(updateDoc(doc(owner, 'lessonTemplates', 't1', 'versions', 'v1'), { changeSummary: 'edited' }))
  })

  it('allows an active member of a non-personal organization without changing the rule model', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'organizations', 'school-1'), { type: 'school' })
      await setDoc(doc(context.firestore(), 'organizations', 'school-1', 'members', 'teacher-a'), { role: 'teacher', status: 'active', membershipVersion: 1 })
    })
    const teacher = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertSucceeds(setDoc(doc(teacher, 'lessonTemplates', 'school-template'), {
      orgId: 'school-1', createdByUid: 'teacher-a', draft: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' },
      currentPublishedVersionId: null, status: 'DRAFT', visibility: 'PRIVATE',
    }))
  })

  it('rejects a version whose templateId or orgId does not match its parent template', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await setDoc(doc(owner, 'lessonTemplates', 't1'), { orgId: 'personal_teacher-a', createdByUid: 'teacher-a', draft: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' }, currentPublishedVersionId: null, status: 'DRAFT', visibility: 'PRIVATE' })
    await assertFails(setDoc(doc(owner, 'lessonTemplates', 't1', 'versions', 'bad'), { templateId: 'other', orgId: 'personal_teacher-b', schemaVersion: 1, content: {}, createdByUid: 'teacher-a', immutable: true }))
  })
})

describe('lessonRuns Firestore rules', () => {
  it('lets the owning teacher read their own lessonRun but not another teacher\'s', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'organizations', 'personal_teacher-a', 'members', 'teacher-a'), { role: 'owner', status: 'active', membershipVersion: 1 })
      await setDoc(doc(context.firestore(), 'lessonRuns', 'run-1'), { orgId: 'personal_teacher-a', templateId: 't1', primaryTeacherUid: 'teacher-a', status: 'DRAFT' })
    })
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const other = environment.authenticatedContext('teacher-b', teacherToken).firestore()
    await assertSucceeds(getDoc(doc(owner, 'lessonRuns', 'run-1')))
    await assertFails(getDoc(doc(other, 'lessonRuns', 'run-1')))
  })

  it('rejects any client write to lessonRuns', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertFails(setDoc(doc(owner, 'lessonRuns', 'run-x'), { orgId: 'personal_teacher-a', templateId: 't1', primaryTeacherUid: 'teacher-a', status: 'DRAFT' }))
  })

  it('denies all client read/write of the lessonRun idempotency store', async () => {
    const db = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const reference = doc(db, 'lessonRunIdempotency', 'some-key')
    await assertFails(getDoc(reference))
    await assertFails(setDoc(reference, { lessonRunId: 'run-1' }))
  })
})

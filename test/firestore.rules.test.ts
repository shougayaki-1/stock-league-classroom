import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

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

  it('limits the private billing profile to active owner/admin members', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'organizations', 'school-1'), { type: 'school' })
      await setDoc(doc(db, 'organizations', 'school-1', 'members', 'owner-a'), { role: 'owner', status: 'active' })
      await setDoc(doc(db, 'organizations', 'school-1', 'members', 'admin-a'), { role: 'admin', status: 'active' })
      await setDoc(doc(db, 'organizations', 'school-1', 'members', 'teacher-a'), { role: 'teacher', status: 'active' })
      await setDoc(doc(db, 'organizations', 'school-1', 'members', 'owner-suspended'), { role: 'owner', status: 'suspended' })
      await setDoc(doc(db, 'organizations', 'school-1', 'billingPrivate', 'profile'), {
        billingProfile: { legalName: 'Private School', updatedByUid: 'owner-a' },
      })
    })

    const privateProfile = (uid: string) => doc(
      environment.authenticatedContext(uid, teacherToken).firestore(),
      'organizations', 'school-1', 'billingPrivate', 'profile',
    )
    await assertSucceeds(getDoc(privateProfile('owner-a')))
    await assertSucceeds(getDoc(privateProfile('admin-a')))
    await assertFails(getDoc(privateProfile('teacher-a')))
    await assertFails(getDoc(privateProfile('owner-suspended')))
    await assertFails(getDoc(privateProfile('other-a')))
    await assertFails(getDocs(collection(
      environment.authenticatedContext('owner-a', teacherToken).firestore(),
      'organizations', 'school-1', 'billingPrivate',
    )))
    await assertFails(updateDoc(privateProfile('owner-a'), { billingProfile: { legalName: 'tampered' } }))
  })
})

describe('planDefinitions/{planId}', () => {
  beforeEach(async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'planDefinitions', 'FREE'), { planId: 'FREE', displayName: '無料', limits: {} })
    })
  })

  it('allows a signed-in teacher to read and list plan definitions', async () => {
    const firestore = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertSucceeds(getDoc(doc(firestore, 'planDefinitions', 'FREE')))
    await assertSucceeds(getDocs(collection(firestore, 'planDefinitions')))
  })

  it('denies writes from clients and unauthenticated reads', async () => {
    const teacherFirestore = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertFails(setDoc(doc(teacherFirestore, 'planDefinitions', 'FREE'), { displayName: '改ざん' }))
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'planDefinitions', 'FREE')))
  })
})

describe('organizations/{orgId}/aiUsageCounters/{counterId}', () => {
  it('declares an explicit deny rule for the AI usage counters subcollection', () => {
    const rules = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8')
    expect(rules).toMatch(
      /match \/organizations\/\{orgId\}\/aiUsageCounters\/\{counterId\} \{[\s\S]*?allow read, write: if false;[\s\S]*?\}/,
    )
  })

  it('denies all direct client reads and writes', async () => {
    const context = environment.authenticatedContext('teacher-a', teacherToken)
    const counter = doc(context.firestore(), 'organizations/org-1/aiUsageCounters/2026-01-01')
    await assertFails(getDoc(counter))
    await assertFails(setDoc(counter, { count: 1 }))
  })
})

describe('templateShares/{shareId}', () => {
  it('declares an explicit deny rule for the template shares collection', () => {
    const rules = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8')
    expect(rules).toMatch(
      /match \/templateShares\/\{shareId\} \{[\s\S]*?allow read, write: if false;[\s\S]*?\}/,
    )
  })

  it('denies all direct client reads and writes', async () => {
    const context = environment.authenticatedContext('teacher-a', teacherToken)
    const share = doc(context.firestore(), 'templateShares/some-hash')
    await assertFails(getDoc(share))
    await assertFails(setDoc(share, { templateId: 't1' }))
  })
})

describe('templateReports/{reportId}', () => {
  it('declares an explicit deny rule for the template reports collection', () => {
    const rules = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8')
    expect(rules).toMatch(
      /match \/templateReports\/\{reportId\} \{[\s\S]*?allow read, write: if false;[\s\S]*?\}/,
    )
  })

  it('denies all direct client reads and writes', async () => {
    const context = environment.authenticatedContext('teacher-a', teacherToken)
    const report = doc(context.firestore(), 'templateReports/report-1')
    await assertFails(getDoc(report))
    await assertFails(setDoc(report, { templateId: 't1' }))
  })
})

describe('templateReviews/{reviewId}', () => {
  it('declares an explicit deny rule for the template reviews collection', () => {
    const rules = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8')
    expect(rules).toMatch(
      /match \/templateReviews\/\{reviewId\} \{[\s\S]*?allow read, write: if false;[\s\S]*?\}/,
    )
  })

  it('denies all direct client reads and writes', async () => {
    const context = environment.authenticatedContext('teacher-a', teacherToken)
    const review = doc(context.firestore(), 'templateReviews/version-1_teacher-a')
    await assertFails(getDoc(review))
    await assertFails(setDoc(review, { clarityRating: 5 }))
  })
})


describe('lessonTemplates COMMUNITY visibility', () => {
  beforeEach(async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore()
      await setDoc(doc(firestore, 'organizations/personal_teacher-a/members/teacher-a'), { role: 'owner', status: 'active', membershipVersion: 1 })
      await setDoc(doc(firestore, 'lessonTemplates/community-template'), {
        orgId: 'personal_teacher-a', createdByUid: 'teacher-a', currentPublishedVersionId: 'v-current',
        visibility: 'COMMUNITY', status: 'PUBLISHED', draft: {}, createdAt: 'now', updatedAt: 'now',
      })
      await setDoc(doc(firestore, 'lessonTemplates/private-template'), {
        orgId: 'personal_teacher-a', createdByUid: 'teacher-a', currentPublishedVersionId: 'v-current',
        visibility: 'PRIVATE', status: 'PUBLISHED', draft: {}, createdAt: 'now', updatedAt: 'now',
      })
      await setDoc(doc(firestore, 'lessonTemplates/community-template/versions/v-current'), { templateId: 'community-template', orgId: 'personal_teacher-a', content: {} })
      await setDoc(doc(firestore, 'lessonTemplates/community-template/versions/v-old'), { templateId: 'community-template', orgId: 'personal_teacher-a', content: {} })
    })
  })

  it('lets a non-member teacher read a COMMUNITY template but not a PRIVATE one', async () => {
    const outsider = environment.authenticatedContext('teacher-b', teacherToken).firestore()
    await assertSucceeds(getDoc(doc(outsider, 'lessonTemplates/community-template')))
    await assertFails(getDoc(doc(outsider, 'lessonTemplates/private-template')))
  })

  it('lets a non-member teacher read only the currently published version of a COMMUNITY template', async () => {
    const outsider = environment.authenticatedContext('teacher-b', teacherToken).firestore()
    await assertSucceeds(getDoc(doc(outsider, 'lessonTemplates/community-template/versions/v-current')))
    await assertFails(getDoc(doc(outsider, 'lessonTemplates/community-template/versions/v-old')))
  })
})

describe('systemConfig/{documentId}', () => {
  it('denies reads and non-operator writes, but allows an operator to write', async () => {
    const teacherFirestore = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const operatorFirestore = environment.authenticatedContext('operator-a', operatorToken).firestore()
    await assertFails(getDoc(doc(teacherFirestore, 'systemConfig/aiKillSwitch')))
    await assertFails(setDoc(doc(teacherFirestore, 'systemConfig/aiKillSwitch'), { enabled: true }))
    await assertSucceeds(setDoc(doc(operatorFirestore, 'systemConfig/aiKillSwitch'), { enabled: true }))
  })
})

describe('organizations/{orgId}/invitations/{invitationId}', () => {
  it('declares an explicit deny rule for the invitation subcollection', () => {
    const rules = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8')

    expect(rules).toMatch(
      /match \/organizations\/\{orgId\}\/invitations\/\{invitationId\} \{[\s\S]*?allow read, write: if false;[\s\S]*?\}/,
    )
  })

  it('denies all direct client reads and writes', async () => {
    const context = environment.authenticatedContext('teacher-a', teacherToken)
    const invitation = doc(context.firestore(), 'organizations/org-1/invitations/invitation-1')

    await assertFails(getDoc(invitation))
    await assertFails(setDoc(invitation, { email: 'x@example.com' }))
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

  it('allows a normal draft/updatedAt-only edit on a template with no pendingDeletion set', async () => {
    // Companion to the pendingDeletion-rejection test below: without this,
    // an assertFails-only suite cannot distinguish "the rule correctly
    // blocks pending-deletion edits" from "the rule now blocks all updates".
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const valid = { orgId: 'personal_teacher-a', createdByUid: 'teacher-a', draft: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' }, currentPublishedVersionId: null, status: 'DRAFT', visibility: 'PRIVATE' }
    await setDoc(doc(owner, 'lessonTemplates', 'not-pending-delete'), valid)
    await assertSucceeds(updateDoc(doc(owner, 'lessonTemplates', 'not-pending-delete'), {
      draft: { schemaVersion: 1, title: '編集後', description: '', subject: 'SOCIAL_STUDIES' },
      updatedAt: '2026-08-07T00:00:00.000Z',
    }))
  })

  it('rejects updating a template that is pending deletion, even with an otherwise-allowed draft/updatedAt-only diff', async () => {
    // Finding 5: requestSoftDelete (Task 12) sets pendingDeletion on a
    // template, but the update rule had no awareness of it, so a client
    // could still edit the draft of a template already queued for deletion.
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const valid = { orgId: 'personal_teacher-a', createdByUid: 'teacher-a', draft: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' }, currentPublishedVersionId: null, status: 'DRAFT', visibility: 'PRIVATE' }
    await setDoc(doc(owner, 'lessonTemplates', 'pending-delete'), valid)
    await environment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'lessonTemplates', 'pending-delete'), {
        pendingDeletion: { requestedAt: '2026-08-07T00:00:00.000Z', requestedByUid: 'teacher-a', reason: 'test', purgeAfter: '2026-08-14T00:00:00.000Z' },
      })
    })
    await assertFails(updateDoc(doc(owner, 'lessonTemplates', 'pending-delete'), {
      draft: { schemaVersion: 1, title: '編集後', description: '', subject: 'SOCIAL_STUDIES' },
      updatedAt: '2026-08-07T00:00:00.000Z',
    }))
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

describe('lessonRun events are append-only', () => {
  it('lets the owning teacher read events but not another teacher\'s', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'organizations', 'personal_teacher-a', 'members', 'teacher-a'), { role: 'owner', status: 'active', membershipVersion: 1 })
      await setDoc(doc(context.firestore(), 'lessonRuns', 'run-1'), { orgId: 'personal_teacher-a', templateId: 't1', primaryTeacherUid: 'teacher-a', status: 'DRAFT' })
      await setDoc(doc(context.firestore(), 'lessonRuns', 'run-1', 'events', 'evt-0'), { type: 'PARTICIPANT_JOINED', sequence: 0 })
    })
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const other = environment.authenticatedContext('teacher-b', teacherToken).firestore()
    await assertSucceeds(getDoc(doc(owner, 'lessonRuns', 'run-1', 'events', 'evt-0')))
    await assertFails(getDoc(doc(other, 'lessonRuns', 'run-1', 'events', 'evt-0')))
  })

  it('rejects any client write to the events subcollection', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertFails(setDoc(doc(owner, 'lessonRuns', 'run-1', 'events', 'evt-x'), { type: 'FAKE', sequence: 0 }))
  })

  it('denies all client read/write of the per-run event idempotency store', async () => {
    const db = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const reference = doc(db, 'lessonRuns', 'run-1', 'eventIdempotency', 'some-key')
    await assertFails(getDoc(reference))
    await assertFails(setDoc(reference, { eventId: 'run-1_0' }))
  })

  it('denies all client read/write of the per-run meta collection', async () => {
    const db = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const reference = doc(db, 'lessonRuns', 'run-1', 'meta', 'eventCounter')
    await assertFails(getDoc(reference))
    await assertFails(setDoc(reference, { value: 0 }))
  })
})

describe('checkpoints are append-only and restoreGeneration only moves forward', () => {
  it('rejects any client write to checkpoints', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertFails(setDoc(doc(owner, 'lessonRuns', 'run-1', 'checkpoints', 'cp-x'), { sequence: 0 }))
  })

  it('rejects a client attempt to edit lessonRuns.restoreGeneration directly', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertFails(updateDoc(doc(owner, 'lessonRuns', 'run-1'), { restoreGeneration: 999 }))
  })

  it('lets the owning teacher read checkpoints but not another teacher\'s', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'organizations', 'personal_teacher-a', 'members', 'teacher-a'), { role: 'owner', status: 'active', membershipVersion: 1 })
      await setDoc(doc(context.firestore(), 'lessonRuns', 'run-1'), { orgId: 'personal_teacher-a', templateId: 't1', primaryTeacherUid: 'teacher-a', status: 'DRAFT', restoreGeneration: 0 })
      await setDoc(doc(context.firestore(), 'lessonRuns', 'run-1', 'checkpoints', 'cp-1'), { id: 'cp-1', sequence: 5, restoreGeneration: 0 })
    })
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const other = environment.authenticatedContext('teacher-b', teacherToken).firestore()
    await assertSucceeds(getDoc(doc(owner, 'lessonRuns', 'run-1', 'checkpoints', 'cp-1')))
    await assertFails(getDoc(doc(other, 'lessonRuns', 'run-1', 'checkpoints', 'cp-1')))
  })

  it('denies all client read/write of the checkpoint restore idempotency store', async () => {
    const db = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const reference = doc(db, 'lessonRuns', 'run-1', 'checkpointRestoreIdempotency', 'some-key')
    await assertFails(getDoc(reference))
    await assertFails(setDoc(reference, { newRestoreGeneration: 1 }))
  })
})

// Task 5 (Phase C): orders are the system of record for buy/sell
// submissions, but createPendingOrder/transitionOrderStatus are Admin
// SDK-only (functions/src/lessonRuns/orders/repository.ts). Students read
// their team's order state via the RTDB lessonRunTeamState projection
// (Task 13), and teachers via a Callable — neither ever reads Firestore
// orders directly, so unlike events/checkpoints/participants this
// subcollection denies client reads too, not just writes.
describe('lessonRuns orders subcollection is Functions-only', () => {
  it('rejects a direct client write to an order, even by the primary teacher', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'lessonRuns', 'run-1'), { orgId: 'personal_teacher-a', templateId: 't1', primaryTeacherUid: 'teacher-a', status: 'RUNNING' })
    })
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertFails(setDoc(doc(owner, 'lessonRuns', 'run-1', 'orders', 'order-x'), {
      status: 'FILLED', executionPrice: 999999,
    }))
  })

  it('rejects a direct client read of an order, even by the primary teacher', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'lessonRuns', 'run-1'), { orgId: 'personal_teacher-a', templateId: 't1', primaryTeacherUid: 'teacher-a', status: 'RUNNING' })
      await setDoc(doc(context.firestore(), 'lessonRuns', 'run-1', 'orders', 'order-1'), { status: 'PENDING' })
    })
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertFails(getDoc(doc(owner, 'lessonRuns', 'run-1', 'orders', 'order-1')))
  })

  it('denies all client read/write of the order idempotency store', async () => {
    const db = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const reference = doc(db, 'lessonRuns', 'run-1', 'orderIdempotency', 'some-key')
    await assertFails(getDoc(reference))
    await assertFails(setDoc(reference, { orderId: 'order-1' }))
  })
})

// Task 2: participants/teams/responses/results are Firestore's system of
// record for lesson-run membership, but students never read Firestore
// directly — they subscribe to the independent lessonRunMembership/
// lessonRunPublic/lessonRunTeamState RTDB projections instead (see
// database.rules.json). These subcollections therefore follow the exact
// same teacher-only get/list-plus-no-write pattern already established for
// events/checkpoints; no student-facing Firestore rule is added here.
describe('lessonRuns participant/team/response/result subcollections are teacher-read, server-write-only', () => {
  const subcollections = ['participants', 'teams', 'responses', 'results'] as const

  for (const subcollection of subcollections) {
    it(`lets the owning teacher read ${subcollection} but not another teacher's, and rejects any client write`, async () => {
      await environment.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'organizations', 'personal_teacher-a', 'members', 'teacher-a'), { role: 'owner', status: 'active', membershipVersion: 1 })
        await setDoc(doc(context.firestore(), 'lessonRuns', 'run-1'), { orgId: 'personal_teacher-a', templateId: 't1', primaryTeacherUid: 'teacher-a', status: 'DRAFT' })
        await setDoc(doc(context.firestore(), 'lessonRuns', 'run-1', subcollection, 'doc-1'), { seeded: true })
      })
      const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
      const other = environment.authenticatedContext('teacher-b', teacherToken).firestore()

      await assertSucceeds(getDoc(doc(owner, 'lessonRuns', 'run-1', subcollection, 'doc-1')))
      await assertFails(getDoc(doc(other, 'lessonRuns', 'run-1', subcollection, 'doc-1')))
      await assertFails(setDoc(doc(owner, 'lessonRuns', 'run-1', subcollection, 'doc-x'), { fake: true }))
    })
  }
})

// Task 7: saveResponseDraft/submitProposal/decideProposal/confirmResponse
// each keep their own idempotency subcollection under a response doc, same
// deny-by-default shape as eventIdempotency/checkpointRestoreIdempotency
// above. No client, teacher or student, ever needs to read or write these
// directly.
describe('lessonRuns response idempotency subcollections are server-internal only', () => {
  const idempotencySubcollections = [
    'saveDraftIdempotency',
    'submitProposalIdempotency',
    'decideProposalIdempotency',
    'confirmIdempotency',
  ] as const

  for (const subcollection of idempotencySubcollections) {
    it(`denies all client read/write of the response ${subcollection} store`, async () => {
      const db = environment.authenticatedContext('teacher-a', teacherToken).firestore()
      const reference = doc(db, 'lessonRuns', 'run-1', 'responses', 'response-1', subcollection, 'some-key')
      await assertFails(getDoc(reference))
      await assertFails(setDoc(reference, { requestDigest: 'fake' }))
    })
  }
})

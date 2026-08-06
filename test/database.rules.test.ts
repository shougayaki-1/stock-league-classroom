import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { get, ref, set } from 'firebase/database'
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

describe('lessonRun public/private RTDB path split', () => {
  it('lets an org member read the public lessonRun state', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.database().ref('orgAccess/personal_teacher-a/teacher-a').set({ role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 })
      await context.database().ref('orgAccessMeta/personal_teacher-a/teacher-a').set({ membershipVersion: 1, syncState: 'SYNCED' })
      await context.database().ref('lessonRunPublic/run-1').set({ status: 'RUNNING', currentPhaseId: 'phase-1', updatedAtMillis: 1, orgId: 'personal_teacher-a' })
    })
    const owner = environment.authenticatedContext('teacher-a', teacherToken).database()
    await assertSucceeds(get(ref(owner, 'lessonRunPublic/run-1')))
  })

  it('never lets a non-owner read the private lessonRun state, even though they can read the public state at the same lessonRunId', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.database().ref('orgAccess/personal_teacher-b/teacher-b').set({ role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 })
      await context.database().ref('orgAccessMeta/personal_teacher-b/teacher-b').set({ membershipVersion: 1, syncState: 'SYNCED' })
      await context.database().ref('lessonRunPublic/run-2').set({ status: 'RUNNING', currentPhaseId: 'phase-1', updatedAtMillis: 1, orgId: 'personal_teacher-b' })
      await context.database().ref('lessonRunPrivate/run-2').set({ randomSeed: 'top-secret-seed', restoreGeneration: 0, updatedAtMillis: 1, orgId: 'personal_teacher-b' })
    })
    const other = environment.authenticatedContext('teacher-a', teacherToken).database()
    // The regression this test guards against: if lessonRunPrivate were ever
    // nested under lessonRunPublic instead of being a sibling top-level
    // node, a broad read grant on the public tree would leak this.
    await assertFails(get(ref(other, 'lessonRunPrivate/run-2')))
  })

  it('lets only the owning teacher read their own private lessonRun state', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.database().ref('orgAccess/personal_teacher-a/teacher-a').set({ role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 })
      await context.database().ref('orgAccessMeta/personal_teacher-a/teacher-a').set({ membershipVersion: 1, syncState: 'SYNCED' })
      await context.database().ref('lessonRunPrivate/run-1').set({ randomSeed: 'seed', restoreGeneration: 0, updatedAtMillis: 1, orgId: 'personal_teacher-a' })
    })
    const owner = environment.authenticatedContext('teacher-a', teacherToken).database()
    await assertSucceeds(get(ref(owner, 'lessonRunPrivate/run-1')))
  })

  it('rejects any client write to either path — both are server/Functions-only', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).database()
    await assertFails(set(ref(owner, 'lessonRunPublic/run-3'), { status: 'RUNNING', currentPhaseId: null, updatedAtMillis: 1, orgId: 'personal_teacher-a' }))
    await assertFails(set(ref(owner, 'lessonRunPrivate/run-3'), { randomSeed: 'x', restoreGeneration: 0, updatedAtMillis: 1, orgId: 'personal_teacher-a' }))
  })
})

// Table-driven mirror-consistency matrix for lessonRunPublic/lessonRunPrivate.
// Each case is asserted independently against BOTH paths so that a rule
// change that breaks only one of the six rejection reasons (or only one of
// the two paths) shows up as its own failing test, not as a single
// all-or-nothing assertion.
interface MirrorEntry { role: 'owner' | 'member'; status: string; membershipVersion: number; revokedAtSeconds: number }
interface MirrorMeta { membershipVersion: number; syncState: string }
interface MirrorCase {
  description: string
  entry: MirrorEntry | null
  meta: MirrorMeta | null
  authTimeSeconds: number
  expectPublic: boolean
  expectPrivate: boolean
}

const mirrorCases: MirrorCase[] = [
  {
    description: 'fully valid mirror (SYNCED, active owner, matching versions, fresh auth_time)',
    entry: { role: 'owner', status: 'active', membershipVersion: 3, revokedAtSeconds: 100 },
    meta: { membershipVersion: 3, syncState: 'SYNCED' },
    authTimeSeconds: 200,
    expectPublic: true,
    expectPrivate: true,
  },
  {
    description: 'active non-owner member with an otherwise-perfect mirror',
    entry: { role: 'member', status: 'active', membershipVersion: 3, revokedAtSeconds: 100 },
    meta: { membershipVersion: 3, syncState: 'SYNCED' },
    authTimeSeconds: 200,
    expectPublic: true,
    expectPrivate: false,
  },
  {
    description: 'membershipVersion mismatch between orgAccess and orgAccessMeta',
    entry: { role: 'owner', status: 'active', membershipVersion: 3, revokedAtSeconds: 100 },
    meta: { membershipVersion: 4, syncState: 'SYNCED' },
    authTimeSeconds: 200,
    expectPublic: false,
    expectPrivate: false,
  },
  {
    description: 'orgAccessMeta.syncState still PENDING (mid-sync), even though versions already match',
    entry: { role: 'owner', status: 'active', membershipVersion: 3, revokedAtSeconds: 100 },
    meta: { membershipVersion: 3, syncState: 'PENDING' },
    authTimeSeconds: 200,
    expectPublic: false,
    expectPrivate: false,
  },
  {
    description: 'auth.token.auth_time before revokedAtSeconds, even though the mirror looks fully synced',
    entry: { role: 'owner', status: 'active', membershipVersion: 3, revokedAtSeconds: 500 },
    meta: { membershipVersion: 3, syncState: 'SYNCED' },
    authTimeSeconds: 100,
    expectPublic: false,
    expectPrivate: false,
  },
  {
    description: 'missing orgAccess entry entirely',
    entry: null,
    meta: { membershipVersion: 3, syncState: 'SYNCED' },
    authTimeSeconds: 200,
    expectPublic: false,
    expectPrivate: false,
  },
  {
    description: 'missing orgAccessMeta entry entirely',
    entry: { role: 'owner', status: 'active', membershipVersion: 3, revokedAtSeconds: 100 },
    meta: null,
    authTimeSeconds: 200,
    expectPublic: false,
    expectPrivate: false,
  },
]

describe('lessonRun public/private RTDB mirror-consistency table', () => {
  const orgId = 'personal_teacher-table'
  const uid = 'teacher-table'

  const seedMirror = async (testCase: MirrorCase) =>
    environment.withSecurityRulesDisabled(async (context) => {
      if (testCase.entry) await context.database().ref(`orgAccess/${orgId}/${uid}`).set(testCase.entry)
      if (testCase.meta) await context.database().ref(`orgAccessMeta/${orgId}/${uid}`).set(testCase.meta)
    })

  const actorFor = (testCase: MirrorCase) =>
    environment.authenticatedContext(uid, { ...teacherToken, auth_time: testCase.authTimeSeconds }).database()

  for (const testCase of mirrorCases) {
    it(`lessonRunPublic — ${testCase.description} — ${testCase.expectPublic ? 'allowed' : 'rejected'}`, async () => {
      await seedMirror(testCase)
      await environment.withSecurityRulesDisabled(async (context) => {
        await context.database().ref('lessonRunPublic/run-table').set({ status: 'RUNNING', currentPhaseId: null, updatedAtMillis: 1, orgId })
      })
      const attempt = get(ref(actorFor(testCase), 'lessonRunPublic/run-table'))
      if (testCase.expectPublic) await assertSucceeds(attempt)
      else await assertFails(attempt)
    })

    it(`lessonRunPrivate — ${testCase.description} — ${testCase.expectPrivate ? 'allowed' : 'rejected'}`, async () => {
      await seedMirror(testCase)
      await environment.withSecurityRulesDisabled(async (context) => {
        await context.database().ref('lessonRunPrivate/run-table').set({ randomSeed: 'seed', restoreGeneration: 0, updatedAtMillis: 1, orgId })
      })
      const attempt = get(ref(actorFor(testCase), 'lessonRunPrivate/run-table'))
      if (testCase.expectPrivate) await assertSucceeds(attempt)
      else await assertFails(attempt)
    })
  }
})

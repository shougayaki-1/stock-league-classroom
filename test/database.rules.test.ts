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
  // lessonRunTeamState's org-membership branch (the OR'd teacher fallback
  // used when no lessonRunMembership entry exists) is textually identical
  // to lessonRunPublic's — same fields, same operators, no extra role
  // check — so every case below expects the same outcome for both. This
  // column exists to make that assumption an executable assertion: if the
  // two branches are ever hand-edited to drift apart, this table will fail
  // instead of silently under-testing lessonRunTeamState's teacher path.
  expectTeamState: boolean
}

const mirrorCases: MirrorCase[] = [
  {
    description: 'fully valid mirror (SYNCED, active owner, matching versions, fresh auth_time)',
    entry: { role: 'owner', status: 'active', membershipVersion: 3, revokedAtSeconds: 100 },
    meta: { membershipVersion: 3, syncState: 'SYNCED' },
    authTimeSeconds: 200,
    expectPublic: true,
    expectPrivate: true,
    expectTeamState: true,
  },
  {
    description: 'active non-owner member with an otherwise-perfect mirror',
    entry: { role: 'member', status: 'active', membershipVersion: 3, revokedAtSeconds: 100 },
    meta: { membershipVersion: 3, syncState: 'SYNCED' },
    authTimeSeconds: 200,
    expectPublic: true,
    expectPrivate: false,
    expectTeamState: true,
  },
  {
    description: 'membershipVersion mismatch between orgAccess and orgAccessMeta',
    entry: { role: 'owner', status: 'active', membershipVersion: 3, revokedAtSeconds: 100 },
    meta: { membershipVersion: 4, syncState: 'SYNCED' },
    authTimeSeconds: 200,
    expectPublic: false,
    expectPrivate: false,
    expectTeamState: false,
  },
  {
    description: 'orgAccessMeta.syncState still PENDING (mid-sync), even though versions already match',
    entry: { role: 'owner', status: 'active', membershipVersion: 3, revokedAtSeconds: 100 },
    meta: { membershipVersion: 3, syncState: 'PENDING' },
    authTimeSeconds: 200,
    expectPublic: false,
    expectPrivate: false,
    expectTeamState: false,
  },
  {
    description: 'auth.token.auth_time before revokedAtSeconds, even though the mirror looks fully synced',
    entry: { role: 'owner', status: 'active', membershipVersion: 3, revokedAtSeconds: 500 },
    meta: { membershipVersion: 3, syncState: 'SYNCED' },
    authTimeSeconds: 100,
    expectPublic: false,
    expectPrivate: false,
    expectTeamState: false,
  },
  {
    description: 'orgAccess.status is not "active" (e.g. a revoked membership), even though versions match and auth_time is fresh',
    entry: { role: 'owner', status: 'revoked', membershipVersion: 3, revokedAtSeconds: 100 },
    meta: { membershipVersion: 3, syncState: 'SYNCED' },
    authTimeSeconds: 200,
    expectPublic: false,
    expectPrivate: false,
    expectTeamState: false,
  },
  {
    description: 'missing orgAccess entry entirely',
    entry: null,
    meta: { membershipVersion: 3, syncState: 'SYNCED' },
    authTimeSeconds: 200,
    expectPublic: false,
    expectPrivate: false,
    expectTeamState: false,
  },
  {
    description: 'missing orgAccessMeta entry entirely',
    entry: { role: 'owner', status: 'active', membershipVersion: 3, revokedAtSeconds: 100 },
    meta: null,
    authTimeSeconds: 200,
    expectPublic: false,
    expectPrivate: false,
    expectTeamState: false,
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

    // Teacher/org-membership branch only — there is deliberately no
    // lessonRunMembership entry seeded for this uid/run, so this exercises
    // exactly the same six independent rejection reasons (version
    // mismatch, stale auth_time, non-active status, missing orgAccess,
    // missing orgAccessMeta, PENDING syncState) against
    // lessonRunTeamState's teacher fallback branch that the table already
    // covers for lessonRunPublic/lessonRunPrivate above.
    it(`lessonRunTeamState — ${testCase.description} — ${testCase.expectTeamState ? 'allowed' : 'rejected'}`, async () => {
      await seedMirror(testCase)
      await environment.withSecurityRulesDisabled(async (context) => {
        await context.database().ref('lessonRunTeamState/run-table/team-table').set({ orgId, score: 0 })
      })
      const attempt = get(ref(actorFor(testCase), 'lessonRunTeamState/run-table/team-table'))
      if (testCase.expectTeamState) await assertSucceeds(attempt)
      else await assertFails(attempt)
    })
  }
})

// Task 10: lessonRunDisplay (classroom-projector state). Independent
// top-level path, same shape as lessonRunPublic/lessonRunPrivate above —
// readable by (a) a session whose Firebase custom-token claim
// `displayRunId` matches this specific $lessonRunId (minted only via
// exchangeDisplaySessionTokenCallable, functions/src/lessonRuns/
// projections/onCall.ts, after redeeming a one-time hashed session token —
// there is deliberately no direct/unauthenticated read path), or (b) the
// same strict orgAccess/orgAccessMeta teacher condition lessonRunPublic
// uses. No client write is ever allowed (Functions/Admin SDK only, via
// publishLessonProjection).
describe('lessonRunDisplay RTDB path (classroom display projection)', () => {
  it('denies an unauthenticated read entirely (no public URL bypass)', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.database().ref('lessonRunDisplay/run-1').set({ orgId: 'org-1', mode: 'LIVE', title: 't', goal: null, teams: [], teacherGuidance: null, updatedAtMillis: 1 })
    })
    await assertFails(get(ref(environment.unauthenticatedContext().database(), 'lessonRunDisplay/run-1')))
  })

  it('lets an authenticated session whose displayRunId claim matches this run read it', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.database().ref('lessonRunDisplay/run-1').set({ orgId: 'org-1', mode: 'LIVE', title: 't', goal: null, teams: [], teacherGuidance: null, updatedAtMillis: 1 })
    })
    const displaySession = environment.authenticatedContext('display-run-1', { displayRunId: 'run-1' }).database()
    await assertSucceeds(get(ref(displaySession, 'lessonRunDisplay/run-1')))
  })

  it('rejects a displayRunId claim scoped to a different run (no cross-run leakage from a stolen/shared display session)', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.database().ref('lessonRunDisplay/run-2').set({ orgId: 'org-1', mode: 'LIVE', title: 't', goal: null, teams: [], teacherGuidance: null, updatedAtMillis: 1 })
    })
    const displaySession = environment.authenticatedContext('display-run-1', { displayRunId: 'run-1' }).database()
    await assertFails(get(ref(displaySession, 'lessonRunDisplay/run-2')))
  })

  it('rejects a plain authenticated user with no displayRunId claim and no teacher org membership', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.database().ref('lessonRunDisplay/run-1').set({ orgId: 'org-1', mode: 'LIVE', title: 't', goal: null, teams: [], teacherGuidance: null, updatedAtMillis: 1 })
    })
    await assertFails(get(ref(environment.authenticatedContext('random-user').database(), 'lessonRunDisplay/run-1')))
  })

  it('still lets a fully-synced active teacher read via the existing orgAccess condition, without any displayRunId claim', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.database().ref('orgAccess/personal_teacher-a/teacher-a').set({ role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 })
      await context.database().ref('orgAccessMeta/personal_teacher-a/teacher-a').set({ membershipVersion: 1, syncState: 'SYNCED' })
      await context.database().ref('lessonRunDisplay/run-3').set({ orgId: 'personal_teacher-a', mode: 'LIVE', title: 't', goal: null, teams: [], teacherGuidance: null, updatedAtMillis: 1 })
    })
    const teacher = environment.authenticatedContext('teacher-a', teacherToken).database()
    await assertSucceeds(get(ref(teacher, 'lessonRunDisplay/run-3')))
  })

  it('rejects a teacher whose orgAccess mirror is broken (membershipVersion mismatch), even with no displayRunId claim', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.database().ref('orgAccess/personal_teacher-b/teacher-b').set({ role: 'owner', status: 'active', membershipVersion: 3, revokedAtSeconds: 0 })
      await context.database().ref('orgAccessMeta/personal_teacher-b/teacher-b').set({ membershipVersion: 4, syncState: 'SYNCED' })
      await context.database().ref('lessonRunDisplay/run-4').set({ orgId: 'personal_teacher-b', mode: 'LIVE', title: 't', goal: null, teams: [], teacherGuidance: null, updatedAtMillis: 1 })
    })
    const teacher = environment.authenticatedContext('teacher-b', teacherToken).database()
    await assertFails(get(ref(teacher, 'lessonRunDisplay/run-4')))
  })

  it('rejects any client write, from a display session, a student, or a teacher alike', async () => {
    const displaySession = environment.authenticatedContext('display-run-1', { displayRunId: 'run-1' }).database()
    await assertFails(set(ref(displaySession, 'lessonRunDisplay/run-1'), { mode: 'LIVE' }))
    const teacher = environment.authenticatedContext('teacher-a', teacherToken).database()
    await assertFails(set(ref(teacher, 'lessonRunDisplay/run-1'), { mode: 'LIVE' }))
  })
})

// Task 2: participant membership mirror. lessonRunMembership/{runId}/{uid} is
// an Admin-SDK-only mirror of the Firestore participant record. Every
// visibility class below (own-entry read, public read, per-team read) must
// stay on an independent top-level path — see the design note above the
// mirror-consistency table for why an ancestor `.read` would be
// unrevokable by a descendant `.read: false`.
describe('lessonRunMembership mirror (participant own-entry read only)', () => {
  const seedMembership = async (runId: string, uid: string, entry: { access: 'ACTIVE' | 'REVOKED'; teamId?: string }) =>
    environment.withSecurityRulesDisabled(async (context) => {
      await context.database().ref(`lessonRunMembership/${runId}/${uid}`).set(entry)
    })

  it('lets a participant read only their own membership mirror entry, not another participant\'s', async () => {
    await seedMembership('run-1', 'student-a', { access: 'ACTIVE', teamId: 'team-a' })
    const studentA = environment.authenticatedContext('student-a').database()
    const studentB = environment.authenticatedContext('student-b').database()
    await assertSucceeds(get(ref(studentA, 'lessonRunMembership/run-1/student-a')))
    await assertFails(get(ref(studentB, 'lessonRunMembership/run-1/student-a')))
  })

  it('rejects any client write to the membership mirror, even by the mirrored uid writing their own entry', async () => {
    const studentA = environment.authenticatedContext('student-a').database()
    await assertFails(set(ref(studentA, 'lessonRunMembership/run-1/student-a'), { access: 'ACTIVE', teamId: 'team-a' }))
  })
})

describe('lessonRunPublic/lessonRunTeamState: student OR-branch added without weakening the existing teacher branch', () => {
  const seedMembership = async (runId: string, uid: string, entry: { access: 'ACTIVE' | 'REVOKED'; teamId?: string }) =>
    environment.withSecurityRulesDisabled(async (context) => {
      await context.database().ref(`lessonRunMembership/${runId}/${uid}`).set(entry)
    })

  it('lets an active participant read public state and only their own team state', async () => {
    await seedMembership('run-1', 'student-a', { access: 'ACTIVE', teamId: 'team-a' })
    const studentA = environment.authenticatedContext('student-a').database()
    await assertSucceeds(get(ref(studentA, 'lessonRunPublic/run-1')))
    await assertSucceeds(get(ref(studentA, 'lessonRunTeamState/run-1/team-a')))
    await assertFails(get(ref(studentA, 'lessonRunTeamState/run-1/team-b')))
    await assertFails(get(ref(studentA, 'lessonRunPrivate/run-1')))
  })

  it('fails closed when the membership mirror is absent entirely', async () => {
    const unknownStudent = environment.authenticatedContext('unknown-student').database()
    await assertFails(get(ref(unknownStudent, 'lessonRunPublic/run-1')))
    await assertFails(get(ref(unknownStudent, 'lessonRunTeamState/run-1/team-a')))
  })

  it('fails closed when the participant has been REVOKED', async () => {
    await seedMembership('run-1', 'student-b', { access: 'REVOKED', teamId: 'team-b' })
    const studentB = environment.authenticatedContext('student-b').database()
    await assertFails(get(ref(studentB, 'lessonRunPublic/run-1')))
    await assertFails(get(ref(studentB, 'lessonRunTeamState/run-1/team-b')))
  })

  it('does not let an active participant of one run read another run\'s public or team state', async () => {
    await seedMembership('run-1', 'student-a', { access: 'ACTIVE', teamId: 'team-a' })
    const studentA = environment.authenticatedContext('student-a').database()
    await assertFails(get(ref(studentA, 'lessonRunPublic/run-2')))
    await assertFails(get(ref(studentA, 'lessonRunTeamState/run-2/team-a')))
  })

  it('rejects any client write from a student, even one with a fully valid ACTIVE mirror', async () => {
    await seedMembership('run-1', 'student-a', { access: 'ACTIVE', teamId: 'team-a' })
    const studentA = environment.authenticatedContext('student-a').database()
    await assertFails(set(ref(studentA, 'lessonRunPublic/run-1'), { status: 'RUNNING' }))
    await assertFails(set(ref(studentA, 'lessonRunTeamState/run-1/team-a'), { score: 100 }))
  })

  it('still lets a fully-synced active teacher read public and team state with no membership mirror entry at all', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.database().ref('orgAccess/personal_teacher-a/teacher-a').set({ role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 })
      await context.database().ref('orgAccessMeta/personal_teacher-a/teacher-a').set({ membershipVersion: 1, syncState: 'SYNCED' })
      await context.database().ref('lessonRunPublic/run-3').set({ status: 'RUNNING', currentPhaseId: null, updatedAtMillis: 1, orgId: 'personal_teacher-a' })
      await context.database().ref('lessonRunTeamState/run-3/team-a').set({ orgId: 'personal_teacher-a', score: 0 })
    })
    const teacher = environment.authenticatedContext('teacher-a', teacherToken).database()
    await assertSucceeds(get(ref(teacher, 'lessonRunPublic/run-3')))
    await assertSucceeds(get(ref(teacher, 'lessonRunTeamState/run-3/team-a')))
  })

  // The complementary "still rejects a teacher whose mirror is broken"
  // coverage lives in the `lessonRun public/private RTDB mirror-consistency
  // table` above (see its `expectTeamState` column): each of version
  // mismatch, PENDING syncState, stale auth_time, non-active status, and
  // missing orgAccess/orgAccessMeta is exercised there as an independent
  // case against lessonRunPublic, lessonRunPrivate, AND lessonRunTeamState.
  // A prior version of this suite asserted all of those conditions at once
  // in a single non-parameterized test here, but the seeded data actually
  // only violated PENDING syncState (membershipVersion was 2 on both sides,
  // and auth_time 1000 >= revokedAtSeconds 500) — so it silently failed to
  // prove the version-mismatch and stale-auth_time checks were still
  // enforced. That test name overstated its own coverage; it has been
  // replaced by the parameterized table.
})

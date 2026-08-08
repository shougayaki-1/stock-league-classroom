import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { get as rtdbGet, ref as rtdbRef } from 'firebase/database'
import { doc as firestoreDoc, getDoc as firestoreGetDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

/**
 * Task 17 Step 3: a regression test that re-verifies the authorization
 * boundaries Task 2 (RTDB mirrors) and Task 10 (lessonRun RTDB projections)
 * already established, from the six actors' point of view Task 17's route
 * guards actually need to reason about. This does NOT change any existing
 * Rules — see database.rules.json/firestore.rules, both untouched by this
 * task — it only proves, in one place, that every top-level path a Task 17
 * guard or a guarded screen reads enforces the boundary that guard assumes.
 *
 * The six actors (brief Step 3):
 *  - teacher:          an ACTIVE member of run-1's org, assigned a role on run-1 (teacherRoles)
 *  - student:          an ACTIVE participant of run-1, on team-a
 *  - otherTeamStudent: an ACTIVE participant of run-1, but on team-b (not team-a)
 *  - otherOrgTeacher:  an ACTIVE member of a DIFFERENT org (org-2), unrelated to run-1
 *  - suspendedMember:  a SUSPENDED member of run-1's own org (org-1)
 *  - displaySession:   an unrelated uid holding only the displayRunId custom-claim minted for run-1's classroom display
 */
const projectId = 'demo-stock-league-classroom-lesson-platform'
const teacherToken = { email_verified: true, firebase: { sign_in_provider: 'google.com' as const } }

let environment: RulesTestEnvironment

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    database: { rules: readFileSync(join(process.cwd(), 'database.rules.json'), 'utf8') },
    firestore: { rules: readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8') },
  })
})

beforeEach(async () => {
  await environment.clearDatabase()
  await environment.clearFirestore()
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.database()
    const firestore = context.firestore()

    // org-1: teacher-a is an ACTIVE member; teacher-suspended is a SUSPENDED member of the SAME org.
    await database.ref('orgAccess/org-1/teacher-a').set({ role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 })
    await database.ref('orgAccessMeta/org-1/teacher-a').set({ membershipVersion: 1, syncState: 'SYNCED' })
    await database.ref('orgAccess/org-1/teacher-suspended').set({ role: 'teacher', status: 'suspended', membershipVersion: 1, revokedAtSeconds: 0 })
    await database.ref('orgAccessMeta/org-1/teacher-suspended').set({ membershipVersion: 1, syncState: 'SYNCED' })
    // org-2: teacher-b is ACTIVE, but org-2 has nothing to do with run-1.
    await database.ref('orgAccess/org-2/teacher-b').set({ role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 })
    await database.ref('orgAccessMeta/org-2/teacher-b').set({ membershipVersion: 1, syncState: 'SYNCED' })

    await firestore.doc('organizations/org-1/members/teacher-a').set({ status: 'active', role: 'owner', membershipVersion: 1 })
    await firestore.doc('organizations/org-1/members/teacher-suspended').set({ status: 'suspended', role: 'teacher', membershipVersion: 1 })
    await firestore.doc('organizations/org-2/members/teacher-b').set({ status: 'active', role: 'owner', membershipVersion: 1 })
    await firestore.doc('lessonRuns/run-1').set({
      orgId: 'org-1', templateId: 'tmpl-1', status: 'RUNNING',
      primaryTeacherUid: 'teacher-a', teacherRoles: { 'teacher-a': 'PRIMARY' },
    })

    // run-1: student-a is ACTIVE on team-a; student-b is ACTIVE on team-b (same run, different team).
    await database.ref('lessonRunMembership/run-1/student-a').set({ access: 'ACTIVE', teamId: 'team-a' })
    await database.ref('lessonRunMembership/run-1/student-b').set({ access: 'ACTIVE', teamId: 'team-b' })
    await database.ref('lessonRunPublic/run-1').set({
      status: 'RUNNING', currentPhaseId: 'phase-1', updatedAtMillis: 1, orgId: 'org-1',
      remainingPhaseSeconds: 60, publicTask: null, notifications: [],
    })
    await database.ref('lessonRunTeamState/run-1/team-a').set({ orgId: 'org-1', proposals: [] })
    await database.ref('lessonRunDisplay/run-1').set({
      orgId: 'org-1', mode: 'START', title: 'デモ授業', goal: null, teams: [], teacherGuidance: null, updatedAtMillis: 1,
    })
  })
})

afterAll(async () => environment?.cleanup())

type Actor = 'teacher' | 'student' | 'otherTeamStudent' | 'otherOrgTeacher' | 'suspendedMember' | 'displaySession'
const actors: Actor[] = ['teacher', 'student', 'otherTeamStudent', 'otherOrgTeacher', 'suspendedMember', 'displaySession']

function contextFor(actor: Actor) {
  switch (actor) {
    case 'teacher': return environment.authenticatedContext('teacher-a', teacherToken)
    case 'student': return environment.authenticatedContext('student-a')
    case 'otherTeamStudent': return environment.authenticatedContext('student-b')
    case 'otherOrgTeacher': return environment.authenticatedContext('teacher-b', teacherToken)
    case 'suspendedMember': return environment.authenticatedContext('teacher-suspended', teacherToken)
    case 'displaySession': return environment.authenticatedContext('display-uid', { displayRunId: 'run-1' })
  }
}

const expectOutcome = (allowed: boolean, promise: Promise<unknown>) => (allowed ? assertSucceeds(promise) : assertFails(promise))

describe('lesson platform Rules integration (Task 17 Step 3)', () => {
  describe.each(actors)('as %s', (actor) => {
    it('reads lessonRunMembership/run-1/student-a (own-uid-only, RTDB)', async () => {
      const allowed = actor === 'student'
      await expectOutcome(allowed, rtdbGet(rtdbRef(contextFor(actor).database(), 'lessonRunMembership/run-1/student-a')))
    })

    it('reads lessonRunPublic/run-1 (own-membership-OR-org-member, RTDB)', async () => {
      const allowed = actor === 'teacher' || actor === 'student' || actor === 'otherTeamStudent'
      await expectOutcome(allowed, rtdbGet(rtdbRef(contextFor(actor).database(), 'lessonRunPublic/run-1')))
    })

    it('reads lessonRunTeamState/run-1/team-a (own-team-OR-org-member, RTDB)', async () => {
      const allowed = actor === 'teacher' || actor === 'student'
      await expectOutcome(allowed, rtdbGet(rtdbRef(contextFor(actor).database(), 'lessonRunTeamState/run-1/team-a')))
    })

    it('reads lessonRunDisplay/run-1 (display-session-claim-OR-org-member, RTDB)', async () => {
      const allowed = actor === 'teacher' || actor === 'displaySession'
      await expectOutcome(allowed, rtdbGet(rtdbRef(contextFor(actor).database(), 'lessonRunDisplay/run-1')))
    })

    it('reads lessonRuns/run-1 (teacher()-AND-active-org-member, Firestore)', async () => {
      const allowed = actor === 'teacher'
      await expectOutcome(allowed, firestoreGetDoc(firestoreDoc(contextFor(actor).firestore(), 'lessonRuns/run-1')))
    })
  })
})

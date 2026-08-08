import { describe, expect, it, vi } from 'vitest'
import { createLessonRun } from '../functions/src/lessonRuns/createLessonRun'
import { transitionPhase } from '../functions/src/lessonRuns/phases/transitionPhase'
import { writeCheckpoint, restoreCheckpoint } from '../functions/src/lessonRuns/checkpoint'
import { transferPrimaryTeacher } from '../functions/src/lessonRuns/interventions'
import { issueRecoveryCode, wireRecoverParticipant, sha256Hex } from '../functions/src/lessonRuns/recovery'
import { interruptLesson, resumeLesson, type LifecycleTransitionFn } from '../functions/src/lessonRuns/recoveryLifecycle'
import { joinLessonRun } from '../functions/src/lessonRuns/joinLessonRun'
import { assignParticipantToTeam } from '../functions/src/lessonRuns/teams/assignTeam'
import { buildLessonResult } from '../functions/src/lessonRuns/results/buildResults'
import { toLessonRunDisplayState } from '../functions/src/lessonRuns/projections/displayProjection'
import type { LessonRunProjectionSource } from '../functions/src/lessonRuns/projections/source'
import { submitSurvey } from '../functions/src/lessonRuns/surveys/submitSurvey'

/**
 * Task 18 (§27.3): a cross-cutting acceptance test that combines Task
 * 1-17's already-shipped functions into full lesson-lifecycle scenarios no
 * single task's own test file exercises together. This is NOT new
 * production logic — every function called below is imported unmodified
 * from functions/src/lessonRuns/**, exactly as production wires it (see
 * each file's own *WithAdminSdk export for the real Firestore/RTDB
 * plumbing this test substitutes with the same in-memory fake every
 * existing functions/src/**\/*.test.ts already uses).
 *
 * Runs under the root vite.config.ts (`test/*.acceptance.test.{ts,tsx}`,
 * see that file's comment) rather than functions/'s own vitest — plain
 * Node/esbuild resolution reaches across the workspace boundary into
 * functions/src for read purposes only; nothing here touches a real
 * Firestore/RTDB/Cloud Functions emulator.
 */

// ---------------------------------------------------------------------------
// Shared in-memory Firestore fake — same "path -> data" transaction shape
// every functions/src/lessonRuns/**/*.test.ts already defines locally
// (see phases/transitionPhase.test.ts's own copy, which this is a straight
// copy of plus `update`/`delete`), reused here across every module under
// test so a single scenario's writes are visible to the next step, the way
// a single, shared, real Firestore instance would behave in production.
// ---------------------------------------------------------------------------
const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    runTransaction: async <T>(fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (path: string, data: Record<string, unknown>) => void
      update: (path: string, data: Record<string, unknown>) => void
    }) => Promise<T>) => {
      let written = false
      return fn({
        get: async (path: string) => {
          if (written) throw new Error('Firestore transactions require all reads to be executed before all writes.')
          return { exists: docs.has(path), data: () => docs.get(path) }
        },
        set: (path: string, data: Record<string, unknown>) => { written = true; docs.set(path, data) },
        update: (path: string, data: Record<string, unknown>) => {
          written = true
          docs.set(path, { ...(docs.get(path) ?? {}), ...data })
        },
      })
    },
  }
}

// A minimal, well-formed phase graph (RUNNING boundary phase + terminal
// REFLECTION phase) so transitions into RUNNING pass validateLessonForStart.
const validTemplateSnapshot = {
  phases: [
    { id: 'market', type: 'MARKET', progression: 'TIMED', durationSeconds: 60, nextPhaseIds: ['reflection'], displayConfig: {} },
    { id: 'reflection', type: 'REFLECTION', progression: 'SUBMISSION_BASED', requiredCompletionRatio: 0.5, nextPhaseIds: [], displayConfig: {} },
  ],
}

describe('Task 18: lesson lifecycle acceptance', () => {
  // -------------------------------------------------------------------------
  // Step 1: 教材版固定 (template snapshot pinning)
  // -------------------------------------------------------------------------
  describe('Step 1: template version pinning', () => {
    it('templateSnapshot and the running phase/status are unaffected by later draft edits or a new published version', async () => {
      const fake = makeFakeFirestore()
      fake.docs.set('lessonTemplates/tpl-1', { orgId: 'org-1', currentPublishedVersionId: 'v1' })
      fake.docs.set('lessonTemplates/tpl-1/versions/v1', {
        templateId: 'tpl-1', orgId: 'org-1',
        content: { schemaVersion: 1, title: 'v1 title', description: 'v1 desc', subject: 'SOCIAL_STUDIES' },
      })

      const created = await createLessonRun({
        firestore: fake as never,
        generateRandomSeed: () => 'seed-1', generateLessonRunId: () => 'run-1',
        lessonRunIdempotencyKey: 'idem-1', orgId: 'org-1', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a',
      })
      const runAtCreation = fake.docs.get(`lessonRuns/${created.lessonRunId}`) as Record<string, unknown>
      // Give the run the phase graph transitionPhase needs to validate a RUNNING start.
      fake.docs.set(`lessonRuns/${created.lessonRunId}`, {
        ...runAtCreation, status: 'WAITING', currentPhaseId: null, subject: 'SOCIAL_STUDIES', templateSnapshot: validTemplateSnapshot,
      })

      // Teacher now edits the ORIGINAL template's draft AND publishes a brand
      // new v2 — neither of these Firestore docs is the run's own snapshot.
      fake.docs.set('lessonTemplates/tpl-1/versions/v1', {
        templateId: 'tpl-1', orgId: 'org-1',
        content: { schemaVersion: 1, title: 'EDITED AFTER RUN START', description: 'draft edit', subject: 'SOCIAL_STUDIES' },
      })
      fake.docs.set('lessonTemplates/tpl-1/versions/v2', {
        templateId: 'tpl-1', orgId: 'org-1',
        content: { schemaVersion: 1, title: 'v2 title', description: 'v2 desc', subject: 'SOCIAL_STUDIES' },
      })
      fake.docs.set('lessonTemplates/tpl-1', { orgId: 'org-1', currentPublishedVersionId: 'v2' })

      const beforeTransition = fake.docs.get(`lessonRuns/${created.lessonRunId}`) as Record<string, unknown>
      expect(beforeTransition.templateSnapshot).toEqual(validTemplateSnapshot)

      // Start the lesson (WAITING -> RUNNING): the in-progress phase/status
      // must still be driven by the run's own frozen templateSnapshot.
      const writeCheckpointFn = vi.fn().mockResolvedValue({ checkpointId: 'cp-1', deduplicated: false })
      await transitionPhase({
        firestore: fake as never, actorId: 'teacher-a', writeCheckpoint: writeCheckpointFn,
      }, { lessonRunId: created.lessonRunId, targetStatus: 'RUNNING', reason: '開始', idempotencyKey: 'start-1' })

      const afterTransition = fake.docs.get(`lessonRuns/${created.lessonRunId}`) as Record<string, unknown>
      expect(afterTransition.status).toBe('RUNNING')
      // The snapshot pinned at creation time is untouched by the draft edit
      // and the new v2 publish that happened afterward.
      expect(afterTransition.templateSnapshot).toEqual(validTemplateSnapshot)
      expect((afterTransition.templateSnapshot as typeof validTemplateSnapshot).phases[1].id).toBe('reflection')
    })
  })

  // -------------------------------------------------------------------------
  // Step 2: 引継ぎ・端末復帰 (handoff + device recovery)
  // -------------------------------------------------------------------------
  describe('Step 2: primary-teacher handoff and student device recovery', () => {
    it('the assistant teacher can keep running the lesson after taking over PRIMARY, and a recovered student is denied on the old device', async () => {
      const fake = makeFakeFirestore()
      fake.docs.set('lessonRuns/run-2', {
        id: 'run-2', orgId: 'org-1', status: 'RUNNING', currentPhaseId: 'market',
        subject: 'SOCIAL_STUDIES', templateSnapshot: validTemplateSnapshot,
        teacherRoles: { 'teacher-primary': 'PRIMARY', 'teacher-assistant': 'ASSISTANT' },
      })

      // --- Handoff: primary disconnects, transfers PRIMARY to the assistant ---
      const transfer = await transferPrimaryTeacher({ firestore: fake as never }, {
        lessonRunId: 'run-2', callerUid: 'teacher-primary', newPrimaryTeacherUid: 'teacher-assistant',
        reason: '主担当端末が切断', idempotencyKey: 'transfer-1',
      })
      expect(transfer).toMatchObject({ previousPrimaryTeacherUid: 'teacher-primary', newPrimaryTeacherUid: 'teacher-assistant', deduplicated: false })
      const runAfterTransfer = fake.docs.get('lessonRuns/run-2') as { teacherRoles: Record<string, string> }
      expect(runAfterTransfer.teacherRoles).toEqual({ 'teacher-primary': 'ASSISTANT', 'teacher-assistant': 'PRIMARY' })

      // The former primary can no longer transfer (no longer PRIMARY) —
      // handoff genuinely moved control, it did not merely duplicate it.
      await expect(transferPrimaryTeacher({ firestore: fake as never }, {
        lessonRunId: 'run-2', callerUid: 'teacher-primary', newPrimaryTeacherUid: 'teacher-assistant',
        reason: '再試行', idempotencyKey: 'transfer-2',
      })).rejects.toThrow('Only the primary teacher may transfer the primary role')

      // The new primary CAN keep driving the lesson forward (a phase-only
      // transition, proving control genuinely continued post-handoff).
      const phaseMove = await transitionPhase({
        firestore: fake as never, actorId: 'teacher-assistant', writeCheckpoint: vi.fn().mockResolvedValue({ checkpointId: 'cp', deduplicated: false }),
      }, { lessonRunId: 'run-2', targetPhaseId: 'reflection', reason: '新primaryが進行', idempotencyKey: 'phase-1' })
      expect(phaseMove.currentPhaseId).toBe('reflection')

      // --- Student device recovery ---
      fake.docs.set('lessonRuns/run-2/participants/participant-s1', {
        id: 'participant-s1', lessonRunId: 'run-2', orgId: 'org-1', authUid: 'old-device-uid',
        identityMode: 'QUICK_JOIN', displayName: '生徒S', teamId: 'team-a', status: 'ACTIVE', sessionVersion: 0,
        joinedAt: 'now', lastSeenAt: 'now',
      })

      const issued = await issueRecoveryCode({
        firestore: fake as never, hashCode: sha256Hex, generateCode: () => 'FIXEDCODE1',
        now: () => 'now', nowMillis: () => 1_000_000,
      }, { lessonRunId: 'run-2', participantId: 'participant-s1', idempotencyKey: 'issue-1' })
      expect(issued.code).toBe('FIXEDCODE1')
      // The plaintext code is never persisted anywhere in the fake store.
      for (const doc of fake.docs.values()) {
        expect(JSON.stringify(doc)).not.toContain('FIXEDCODE1')
      }

      // Fake RTDB mirror: records the most recent access value per authUid,
      // the same "old UID REVOKED strictly before new UID ACTIVE" contract
      // recoverParticipantWithAdminSdk's production wiring implements via
      // syncLessonRunMembershipWithAdminSdk.
      const mirror = new Map<string, 'ACTIVE' | 'REVOKED'>()
      const mirrorOrder: string[] = []
      const recover = wireRecoverParticipant({
        firestore: fake as never, hashCode: sha256Hex, now: () => 'now', nowMillis: () => 1_000_500,
        syncMirror: async (authUid, access) => { mirror.set(authUid, access); mirrorOrder.push(`${authUid}:${access}`) },
        finalizeStatus: async (result) => {
          const path = `lessonRuns/${result.lessonRunId}/participants/${result.participantId}`
          fake.docs.set(path, { ...(fake.docs.get(path) as Record<string, unknown>), status: result.previousStatus })
        },
      })

      const recovered = await recover({
        lessonRunId: 'run-2', code: 'FIXEDCODE1', newAuthUid: 'new-device-uid', idempotencyKey: 'recover-1',
      })
      expect(recovered.oldAuthUid).toBe('old-device-uid')
      expect(recovered.newAuthUid).toBe('new-device-uid')
      // Old UID REVOKED before new UID ACTIVE — never observed simultaneously ACTIVE.
      expect(mirrorOrder).toEqual(['old-device-uid:REVOKED', 'new-device-uid:ACTIVE'])
      expect(mirror.get('old-device-uid')).toBe('REVOKED')
      expect(mirror.get('new-device-uid')).toBe('ACTIVE')

      // The old device's authUid index is tombstoned (participantId: null),
      // so any lookup keyed by the old UID can no longer resolve a live
      // participant — the "旧端末操作が拒否される" contract at the data layer
      // the RTDB REVOKED mirror above enforces at the realtime layer.
      const oldIndex = fake.docs.get('lessonRuns/run-2/participantsByAuthUid/old-device-uid') as Record<string, unknown>
      expect(oldIndex.participantId).toBeNull()
      expect(oldIndex.revokedForRecovery).toBe(true)

      // The participant's Firestore status is restored (not left at the
      // transient MIGRATING_DEVICE) once both mirror writes settled.
      const participantAfter = fake.docs.get('lessonRuns/run-2/participants/participant-s1') as Record<string, unknown>
      expect(participantAfter.status).toBe('ACTIVE')
      expect(participantAfter.authUid).toBe('new-device-uid')
    })
  })

  // -------------------------------------------------------------------------
  // Step 3: 欠席・途中参加・中断再開
  // -------------------------------------------------------------------------
  describe('Step 3: absence, mid-lesson join, and interrupt/resume', () => {
    it('an ABSENT participant does not break buildLessonResult team aggregation for the teammate who did respond', () => {
      const result = buildLessonResult({
        id: 'result-1', lessonRunId: 'run-3', orgId: 'org-1', phaseId: 'market', generatedAt: 'now',
        responses: [
          // team-a: participant-absent never submitted (ABSENT participant,
          // no LessonResponse doc at all for them — buildLessonResult never
          // even sees a per-participant row for a non-responder).
          {
            id: 'resp-team-a', lessonRunId: 'run-3', orgId: 'org-1', teamId: 'team-a', phaseId: 'market',
            status: 'CONFIRMED', payload: { choice: 'buy' }, submittedByParticipantId: 'participant-present',
          } as never,
        ],
        eventsByResponseId: {},
      })
      // Team aggregation still produces exactly the one real (CONFIRMED)
      // team response — the absent teammate simply contributes nothing,
      // it does not throw or corrupt the team's entry.
      expect(result.responses).toHaveLength(1)
      expect(result.responses[0]).toMatchObject({ scope: 'team', teamId: 'team-a' })
    })

    it('a mid-lesson (WAITING, after other students already joined) participant is assigned to the team with the existing lowest member count, not a fresh empty one', async () => {
      const fake = makeFakeFirestore()
      fake.docs.set('lessonJoinCodes/CODE1', { lessonRunId: 'run-3', status: 'ACTIVE' })
      fake.docs.set('lessonRuns/run-3', { orgId: 'org-1', status: 'WAITING' })
      fake.docs.set('lessonRuns/run-3/meta/teamsIndex', { teamIds: ['team-a', 'team-b'] })
      fake.docs.set('lessonRuns/run-3/teams/team-a', { id: 'team-a', lessonRunId: 'run-3', orgId: 'org-1', displayName: 'A班', memberParticipantIds: ['p-existing-1', 'p-existing-2'], version: 1, representativeParticipantId: 'p-existing-1', confirmationMode: 'REPRESENTATIVE' })
      fake.docs.set('lessonRuns/run-3/teams/team-b', { id: 'team-b', lessonRunId: 'run-3', orgId: 'org-1', displayName: 'B班', memberParticipantIds: ['p-existing-3'], version: 1, representativeParticipantId: 'p-existing-3', confirmationMode: 'REPRESENTATIVE' })

      const syncMembership = vi.fn().mockResolvedValue(undefined)
      const joined = await joinLessonRun({
        firestore: fake as never, authUid: 'late-joiner-uid', generateParticipantId: () => 'p-late', syncMembership,
      }, { joinCode: 'CODE1', identityMode: 'QUICK_JOIN', displayName: '途中参加の生徒', idempotencyKey: 'join-late-1' })

      // The mid-lesson joiner receives the standard, currently-lowest-count
      // team (team-b, 1 member) rather than any new/reset team.
      expect(joined.teamId).toBeUndefined() // assignment is a separate step (assignParticipantToTeam), matching production wiring
      const assignment = await assignParticipantToTeam({
        firestore: fake as never, actorId: 'teacher-a',
      }, { lessonRunId: 'run-3', participantId: joined.participantId, idempotencyKey: 'assign-late-1' })
      expect(assignment.teamId).toBe('team-b')
      // team-a's existing roster (2 members) is untouched by the new join.
      const teamA = fake.docs.get('lessonRuns/run-3/teams/team-a') as { memberParticipantIds: string[] }
      expect(teamA.memberParticipantIds).toEqual(['p-existing-1', 'p-existing-2'])
    })

    it('interrupt then resume follows the same restoreGeneration checkpoint contract (checkpoint precedes resume, restoreGeneration only advances on an explicit restore)', async () => {
      const fake = makeFakeFirestore()
      fake.docs.set('lessonRuns/run-4', {
        id: 'run-4', orgId: 'org-1', status: 'RUNNING', currentPhaseId: 'market', restoreGeneration: 0,
        subject: 'SOCIAL_STUDIES', templateSnapshot: validTemplateSnapshot,
      })

      // A checkpoint exists from the normal RUNNING-boundary auto-checkpoint
      // (writeCheckpoint, Task 5/9's wiring) before the interruption.
      const cp = await writeCheckpoint({
        firestore: fake as never, lessonRunId: 'run-4', phaseId: 'market', sequence: 1,
        snapshot: { marketState: 'mid-session' }, createdBy: 'SYSTEM', idempotencyKey: 'cp-boundary-1',
      })
      expect(cp.deduplicated).toBe(false)

      const transitionAdapter: LifecycleTransitionFn = (input) =>
        transitionPhase({ firestore: fake as never, actorId: 'teacher-a', writeCheckpoint: vi.fn().mockResolvedValue({ checkpointId: 'cp-x', deduplicated: false }) }, input)

      const interrupted = await interruptLesson({
        transitionPhase: transitionAdapter, appendEvent: (input) => {
          // Minimal standalone append (mirrors appendLessonEventWithAdminSdk's
          // contract) reusing the same fake store directly.
          return fake.runTransaction(async (tx) => {
            const path = `lessonRuns/${input.lessonRunId}/events/evt-interrupt`
            tx.set(path, { type: input.type, payload: input.payload })
            return { eventId: 'evt-interrupt', sequence: 99, deduplicated: false }
          })
        }, actorId: 'teacher-a',
      }, {
        lessonRunId: 'run-4', orgId: 'org-1', reason: '通信障害', interimResults: {},
        resumePhaseId: 'market', resumeCheckpointId: cp.checkpointId, idempotencyKey: 'interrupt-1',
      })
      expect(interrupted.transition.status).toBe('INTERRUPTED')
      // restoreGeneration is untouched by a plain interrupt — it is not a restore.
      expect((fake.docs.get('lessonRuns/run-4') as Record<string, unknown>).restoreGeneration).toBe(0)

      const resumed = await resumeLesson({ transitionPhase: transitionAdapter, actorId: 'teacher-a' }, {
        lessonRunId: 'run-4', reason: '端末復旧、再開', idempotencyKey: 'resume-1',
      })
      expect(resumed.status).toBe('WAITING')
      expect((fake.docs.get('lessonRuns/run-4') as Record<string, unknown>).restoreGeneration).toBe(0)

      // A genuine checkpoint restore (distinct from interrupt/resume) is the
      // only thing that advances restoreGeneration, and it does so exactly
      // once per restore — the contract writeCheckpoint's checkpointId
      // hashing (`cp_${restoreGeneration}_...`) depends on.
      const restored = await restoreCheckpoint({
        firestore: fake as never, lessonRunId: 'run-4', checkpointId: cp.checkpointId,
        reason: '念のためチェックポイントへ復元', actorId: 'teacher-a', idempotencyKey: 'restore-1',
      })
      expect(restored.newRestoreGeneration).toBe(1)
      expect((fake.docs.get('lessonRuns/run-4') as Record<string, unknown>).restoreGeneration).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // Step 4: 教室表示とアンケート
  // -------------------------------------------------------------------------
  describe('Step 4: classroom display projection and survey linkage', () => {
    it('toLessonRunDisplayState never surfaces any forbidden field even when the source object carries them', () => {
      const source: LessonRunProjectionSource = {
        orgId: 'org-1', status: 'RUNNING', title: '公開タイトル', goal: '公開ゴール',
        currentPhaseId: 'market', currentPhasePublicTask: '公開タスク', currentPhaseEndsAtMillis: 123,
        updatedAtMillis: 456, teacherGuidance: '教師ガイダンス',
        teams: [{
          id: 'team-a', displayName: 'A班', publicAggregateLabel: '1位',
          // FORBIDDEN on the display projection (see source.ts's JSDoc):
          individualResponses: { 'participant-x': { secretChoice: 'buy' } },
          unsubmittedParticipantIds: ['participant-y'],
        }],
        recentNotifications: [{ id: 'evt-1', type: 'PHASE_CHANGED', occurredAtMillis: 1, actorId: 'teacher-a', payload: { internal: true } }],
        // FORBIDDEN on every projection (spec §26-1):
        randomSeed: 'super-secret-seed',
        restoreGeneration: 3,
        future: { coefficients: [1, 2, 3] },
      }

      const display = toLessonRunDisplayState(source, 1_000)
      const serialized = JSON.stringify(display)
      for (const forbidden of ['super-secret-seed', 'secretChoice', 'participant-y', 'coefficients', 'internal']) {
        expect(serialized).not.toContain(forbidden)
      }
      expect(display).not.toHaveProperty('randomSeed')
      expect(display).not.toHaveProperty('restoreGeneration')
      expect(display).not.toHaveProperty('future')
      expect(display.teams[0]).toEqual({ teamId: 'team-a', displayName: 'A班', publicAggregateLabel: '1位' })
    })

    it('submitSurvey always ties a response to lessonRunId/resultId/participantId, and an ABSENT (not SUSPENDED) participant is allowed to submit', async () => {
      const fake = makeFakeFirestore()
      const participants = new Map<string, { orgId: string; status: string }>([
        ['participant-absent', { orgId: 'org-1', status: 'ABSENT' }],
        ['participant-suspended', { orgId: 'org-1', status: 'SUSPENDED' }],
      ])
      const resolveParticipant = async (_lessonRunId: string, participantId: string) => participants.get(participantId)

      const submitted = await submitSurvey({
        firestore: fake as never, orgId: 'org-1', now: () => 'now', resolveParticipant: resolveParticipant as never,
      }, {
        lessonRunId: 'run-5', resultId: 'result-5', participantId: 'participant-absent' as never,
        answers: { satisfaction: 4 }, idempotencyKey: 'survey-1',
      })
      expect(submitted.deduplicated).toBe(false)
      const stored = fake.docs.get(`lessonRuns/run-5/results/result-5/surveyResponses/${submitted.surveyResponseId}`) as Record<string, unknown>
      expect(stored).toMatchObject({ lessonRunId: 'run-5', resultId: 'result-5', participantId: 'participant-absent' })

      await expect(submitSurvey({
        firestore: fake as never, orgId: 'org-1', now: () => 'now', resolveParticipant: resolveParticipant as never,
      }, {
        lessonRunId: 'run-5', resultId: 'result-5', participantId: 'participant-suspended' as never,
        answers: { satisfaction: 1 }, idempotencyKey: 'survey-2',
      })).rejects.toThrow('Suspended participants may not submit a survey response')

      await expect(submitSurvey({
        firestore: fake as never, orgId: 'org-1', now: () => 'now',
      }, {
        // lessonRunId omitted entirely — must be rejected regardless of resolveParticipant.
        lessonRunId: '', resultId: 'result-5', participantId: 'participant-absent' as never,
        answers: {}, idempotencyKey: 'survey-3',
      })).rejects.toThrow('lessonRunId, resultId, and participantId are all required')
    })
  })
})

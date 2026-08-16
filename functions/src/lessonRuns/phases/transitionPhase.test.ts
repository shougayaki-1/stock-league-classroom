import { describe, expect, it, vi } from 'vitest'
import { transitionPhase } from './transitionPhase'

// Same fake as teams/assignTeam.test.ts / joinLessonRun.test.ts: enforces
// Firestore Admin SDK's "all reads before all writes" transaction
// constraint so a Task-3-Critical-#1-style ordering bug fails a test
// instead of only failing in production. `getCollection` is included so
// Task 3's `prepareStatusTransition` hook tests (below) can exercise a
// subcollection read within the same read-before-write discipline.
const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  const collections = new Map<string, Array<{ id: string; data: Record<string, unknown> }>>()
  const reads: string[] = []
  const deletes: string[] = []
  return {
    docs,
    collections,
    reads,
    deletes,
    runTransaction: async <T>(fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      getCollection: (path: string) => Promise<Array<{ id: string; data: Record<string, unknown> }>>
      set: (path: string, data: Record<string, unknown>) => void
      delete: (path: string) => void
    }) => Promise<T>) => {
      let written = false
      return fn({
        get: async (path: string) => {
          if (written) throw new Error('Firestore transactions require all reads to be executed before all writes.')
          reads.push(path)
          return { exists: docs.has(path), data: () => docs.get(path) }
        },
        getCollection: async (path: string) => {
          if (written) throw new Error('Firestore transactions require all reads to be executed before all writes.')
          reads.push(path)
          return collections.get(path) ?? []
        },
        set: (path: string, data: Record<string, unknown>) => { written = true; docs.set(path, data) },
        delete: (path: string) => { written = true; deletes.push(path); docs.delete(path) },
      })
    },
  }
}

// A minimal, well-formed phase graph (single REFLECTION phase, immediately
// terminal) so tests that transition into RUNNING pass validateLessonForStart
// by default. Tests that specifically exercise Important #1's
// HOME_ECONOMICS/MARKET rejection (or other validation failures) override
// `templateSnapshot`/`subject` via `overrides`.
const validTemplateSnapshot = {
  phases: [
    { id: 'reflection', type: 'REFLECTION', progression: 'SUBMISSION_BASED', requiredCompletionRatio: 0.5, nextPhaseIds: [], displayConfig: {} },
  ],
}

const setUpRun = (docs: Map<string, Record<string, unknown>>, overrides: Record<string, unknown> = {}) => {
  docs.set('lessonRuns/run-1', {
    id: 'run-1', orgId: 'org-1', status: 'WAITING', currentPhaseId: null,
    templateId: 'tpl-1', extraField: 'preserved',
    subject: 'SOCIAL_STUDIES', templateSnapshot: validTemplateSnapshot,
    ...overrides,
  })
}

describe('transitionPhase', () => {
  it('applies a valid status transition, appends LESSON_STATUS_CHANGED, and preserves unrelated fields', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs)
    const writeCheckpoint = vi.fn().mockResolvedValue({ checkpointId: 'cp-1', deduplicated: false })

    const result = await transitionPhase({
      firestore: fake as never, actorId: 'teacher-1', writeCheckpoint, now: () => 'fixed-now',
    }, { lessonRunId: 'run-1', targetStatus: 'RUNNING', reason: '開始', idempotencyKey: 'tx-1' })

    expect(result).toEqual({ status: 'RUNNING', currentPhaseId: null, deduplicated: false })
    const run = fake.docs.get('lessonRuns/run-1') as Record<string, unknown>
    expect(run.status).toBe('RUNNING')
    expect(run.extraField).toBe('preserved')
    const events = [...fake.docs.entries()].filter(([path]) => path.includes('/events/'))
    expect(events).toHaveLength(1)
    expect((events[0][1] as { type: string }).type).toBe('LESSON_STATUS_CHANGED')
  })

  it('rejects a transition not allowed by canTransitionRun', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs, { status: 'COMPLETED' })
    const writeCheckpoint = vi.fn()

    await expect(transitionPhase({
      firestore: fake as never, actorId: 'teacher-1', writeCheckpoint,
    }, { lessonRunId: 'run-1', targetStatus: 'RUNNING', reason: '再開', idempotencyKey: 'tx-2' }))
      .rejects.toThrow('Invalid status transition')
    expect(writeCheckpoint).not.toHaveBeenCalled()
  })

  it('appends PHASE_CHANGED when only targetPhaseId is given, leaving status untouched', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs, { status: 'RUNNING', currentPhaseId: 'phase-a' })
    const writeCheckpoint = vi.fn().mockResolvedValue({ checkpointId: 'cp-1', deduplicated: false })

    const result = await transitionPhase({
      firestore: fake as never, actorId: 'teacher-1', writeCheckpoint,
    }, { lessonRunId: 'run-1', targetPhaseId: 'phase-b', reason: '次のフェーズへ', idempotencyKey: 'tx-3' })

    expect(result).toEqual({ status: 'RUNNING', currentPhaseId: 'phase-b', deduplicated: false })
    const events = [...fake.docs.entries()].filter(([path]) => path.includes('/events/'))
    expect((events[0][1] as { type: string }).type).toBe('PHASE_CHANGED')
    // Moving between phases while status stays RUNNING is not a major
    // phase boundary (only entering RUNNING/REFLECTION is) — no checkpoint.
    expect(writeCheckpoint).not.toHaveBeenCalled()
  })

  it('creates a checkpoint after commit when transitioning into RUNNING (major boundary)', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs, { status: 'WAITING' })
    const writeCheckpoint = vi.fn().mockResolvedValue({ checkpointId: 'cp-1', deduplicated: false })

    await transitionPhase({
      firestore: fake as never, actorId: 'teacher-1', writeCheckpoint,
    }, { lessonRunId: 'run-1', targetStatus: 'RUNNING', reason: '開始', idempotencyKey: 'tx-4' })

    expect(writeCheckpoint).toHaveBeenCalledTimes(1)
    const call = writeCheckpoint.mock.calls[0][0]
    expect(call.lessonRunId).toBe('run-1')
    // The checkpoint's idempotencyKey must be the transition request's own
    // idempotencyKey (task brief's known-issue workaround for
    // writeCheckpoint's checkpointId hashing not being purely
    // (restoreGeneration, sequence)-based).
    expect(call.idempotencyKey).toBe('tx-4')
  })

  it('creates a checkpoint after commit when transitioning into REFLECTION, after calling stopActiveOperations first', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs, { status: 'RUNNING' })
    const writeCheckpoint = vi.fn().mockResolvedValue({ checkpointId: 'cp-1', deduplicated: false })
    const callOrder: string[] = []
    const stopActiveOperations = vi.fn(async () => { callOrder.push('stop') })
    const originalRunTransaction = fake.runTransaction
    fake.runTransaction = (async (fn: never) => { callOrder.push('transaction'); return originalRunTransaction(fn) }) as never

    await transitionPhase({
      firestore: fake as never, actorId: 'teacher-1', writeCheckpoint, stopActiveOperations,
    }, { lessonRunId: 'run-1', targetStatus: 'REFLECTION', reason: '終了', idempotencyKey: 'tx-5' })

    expect(stopActiveOperations).toHaveBeenCalledWith('run-1')
    expect(callOrder).toEqual(['stop', 'transaction'])
    expect(writeCheckpoint).toHaveBeenCalledTimes(1)
  })

  it('does not call stopActiveOperations for transitions other than REFLECTION', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs, { status: 'WAITING' })
    const stopActiveOperations = vi.fn()

    await transitionPhase({
      firestore: fake as never, actorId: 'teacher-1', writeCheckpoint: vi.fn().mockResolvedValue({ checkpointId: 'cp-1', deduplicated: false }), stopActiveOperations,
    }, { lessonRunId: 'run-1', targetStatus: 'RUNNING', reason: '開始', idempotencyKey: 'tx-6' })

    expect(stopActiveOperations).not.toHaveBeenCalled()
  })

  it('is idempotent: replaying the same idempotencyKey returns the prior result without re-appending an event, and still calls writeCheckpoint (self-healing, writeCheckpoint dedups on its own)', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs, { status: 'WAITING' })
    const writeCheckpoint = vi.fn().mockResolvedValue({ checkpointId: 'cp-1', deduplicated: false })
    const deps = { firestore: fake as never, actorId: 'teacher-1', writeCheckpoint }
    const input = { lessonRunId: 'run-1', targetStatus: 'RUNNING' as const, reason: '開始', idempotencyKey: 'tx-7' }

    const first = await transitionPhase(deps, input)
    const second = await transitionPhase(deps, input)

    expect(first.deduplicated).toBe(false)
    expect(second.deduplicated).toBe(true)
    expect(second.status).toBe('RUNNING')
    const events = [...fake.docs.entries()].filter(([path]) => path.includes('/events/'))
    expect(events).toHaveLength(1)
    expect(writeCheckpoint).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['RUNNING', 'ABORTED'],
    ['REFLECTION', 'COMPLETED'],
  ] as const)('releases an existing parent shared reservation in the same transaction for %s -> %s', async (status, targetStatus) => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs, { orgId: 'school-1', status })
    fake.docs.set('organizations/school-1', { type: 'school', parentOrgId: 'parent-1' })
    const reservationPath = 'organizations/parent-1/quotaReservations/concurrentLessonsAndMarkets:school-1:run-1'
    fake.docs.set(reservationPath, {
      reservationId: 'concurrentLessonsAndMarkets:school-1:run-1',
      resourceKey: 'concurrentLessonsAndMarkets', schoolOrgId: 'school-1', targetId: 'run-1',
    })

    const result = await transitionPhase({
      firestore: fake as never, actorId: 'teacher-1', writeCheckpoint: vi.fn(),
    }, { lessonRunId: 'run-1', targetStatus, reason: '終了', idempotencyKey: `terminal-${targetStatus}` })

    expect(result.status).toBe(targetStatus)
    expect(fake.docs.has(reservationPath)).toBe(false)
    expect(fake.deletes).toEqual([reservationPath])
  })

  it('does not release the shared reservation when entering REFLECTION because it remains active quota usage', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs, { orgId: 'school-1', status: 'RUNNING' })
    fake.docs.set('organizations/school-1', { type: 'school', parentOrgId: 'parent-1' })
    const reservationPath = 'organizations/parent-1/quotaReservations/concurrentLessonsAndMarkets:school-1:run-1'
    fake.docs.set(reservationPath, {
      reservationId: 'concurrentLessonsAndMarkets:school-1:run-1',
      resourceKey: 'concurrentLessonsAndMarkets', schoolOrgId: 'school-1', targetId: 'run-1',
    })

    await transitionPhase({
      firestore: fake as never,
      actorId: 'teacher-1',
      writeCheckpoint: vi.fn().mockResolvedValue({ checkpointId: 'cp-1', deduplicated: false }),
    }, { lessonRunId: 'run-1', targetStatus: 'REFLECTION', reason: '振り返り', idempotencyKey: 'reflection-active' })

    expect(fake.docs.has(reservationPath)).toBe(true)
    expect(fake.deletes).toHaveLength(0)
    expect(fake.reads).not.toContain('organizations/school-1')
  })

  it('does not enqueue a delete when the deterministic terminal reservation is absent', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs, { orgId: 'school-1', status: 'RUNNING' })
    fake.docs.set('organizations/school-1', { type: 'school', parentOrgId: 'parent-1' })
    const reservationPath = 'organizations/parent-1/quotaReservations/concurrentLessonsAndMarkets:school-1:run-1'

    await transitionPhase({
      firestore: fake as never, actorId: 'teacher-1', writeCheckpoint: vi.fn(),
    }, { lessonRunId: 'run-1', targetStatus: 'ABORTED', reason: '中止', idempotencyKey: 'terminal-no-reservation' })

    expect(fake.reads).toContain(reservationPath)
    expect(fake.deletes).toHaveLength(0)
  })

  it('replays a terminal transition from its idempotency document without re-reading or re-deleting the reservation', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs, { orgId: 'school-1', status: 'RUNNING' })
    fake.docs.set('organizations/school-1', { type: 'school', parentOrgId: 'parent-1' })
    const reservationPath = 'organizations/parent-1/quotaReservations/concurrentLessonsAndMarkets:school-1:run-1'
    fake.docs.set(reservationPath, {
      reservationId: 'concurrentLessonsAndMarkets:school-1:run-1',
      resourceKey: 'concurrentLessonsAndMarkets', schoolOrgId: 'school-1', targetId: 'run-1',
    })
    const deps = { firestore: fake as never, actorId: 'teacher-1', writeCheckpoint: vi.fn() }
    const input = { lessonRunId: 'run-1', targetStatus: 'ABORTED' as const, reason: '中止', idempotencyKey: 'terminal-replay' }

    const first = await transitionPhase(deps, input)
    const second = await transitionPhase(deps, input)

    expect(first.deduplicated).toBe(false)
    expect(second.deduplicated).toBe(true)
    expect(fake.reads.filter((path) => path === 'organizations/school-1')).toHaveLength(1)
    expect(fake.reads.filter((path) => path === reservationPath)).toHaveLength(1)
    expect(fake.deletes).toEqual([reservationPath])
    const events = [...fake.docs.keys()].filter((path) => path.includes('/events/'))
    expect(events).toHaveLength(1)
  })

  it('throws when neither targetStatus nor targetPhaseId is given', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs)
    await expect(transitionPhase({
      firestore: fake as never, actorId: 'teacher-1', writeCheckpoint: vi.fn(),
    }, { lessonRunId: 'run-1', reason: '何もしない', idempotencyKey: 'tx-8' } as never))
      .rejects.toThrow('Nothing to transition')
  })

  // Critical fix: targetStatus and targetPhaseId are mutually exclusive.
  // Before this guard existed, specifying both caused
  // appendLessonEventInTransaction to be called twice inside the same
  // transaction — the second call's `tx.get(idempotencyPath)` ran AFTER the
  // first call's `tx.set(...)`s, violating Firestore's "all reads before all
  // writes" transaction rule and crashing at runtime with
  // "Firestore transactions require all reads to be executed before all
  // writes." This test's fake enforces that same rule (see makeFakeFirestore
  // above), so it reproduces the crash directly if the guard is removed.
  it('rejects a transition that specifies both targetStatus and targetPhaseId', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs, { status: 'WAITING' })
    const writeCheckpoint = vi.fn()

    await expect(transitionPhase({
      firestore: fake as never, actorId: 'teacher-1', writeCheckpoint,
    }, {
      lessonRunId: 'run-1', targetStatus: 'RUNNING', targetPhaseId: 'phase-a',
      reason: '同時指定', idempotencyKey: 'tx-9',
    })).rejects.toThrow('targetStatus and targetPhaseId cannot both be specified')

    expect(writeCheckpoint).not.toHaveBeenCalled()
    const events = [...fake.docs.entries()].filter(([path]) => path.includes('/events/'))
    expect(events).toHaveLength(0)
  })

  // Important #1: validateLessonForStart (validation.ts) was never wired
  // into any code path that actually starts a lesson, so a HOME_ECONOMICS
  // lesson containing a forbidden MARKET phase (矛盾解消G) could reach
  // RUNNING unchecked. This wires the check into the RUNNING transition.
  describe('validateLessonForStart wiring (Important #1, 矛盾解消G)', () => {
    it('rejects a transition into RUNNING when the lesson is HOME_ECONOMICS with a MARKET phase', async () => {
      const fake = makeFakeFirestore()
      setUpRun(fake.docs, {
        status: 'WAITING',
        subject: 'HOME_ECONOMICS',
        templateSnapshot: {
          phases: [
            { id: 'market', type: 'MARKET', progression: 'TIMED', durationSeconds: 60, nextPhaseIds: ['reflection'], displayConfig: {} },
            { id: 'reflection', type: 'REFLECTION', progression: 'SUBMISSION_BASED', requiredCompletionRatio: 0.5, nextPhaseIds: [], displayConfig: {} },
          ],
        },
      })
      const writeCheckpoint = vi.fn()

      await expect(transitionPhase({
        firestore: fake as never, actorId: 'teacher-1', writeCheckpoint,
      }, { lessonRunId: 'run-1', targetStatus: 'RUNNING', reason: '開始', idempotencyKey: 'tx-10' }))
        .rejects.toThrow('HOME_ECONOMICS_MARKET_FORBIDDEN')

      expect(writeCheckpoint).not.toHaveBeenCalled()
      const run = fake.docs.get('lessonRuns/run-1') as Record<string, unknown>
      expect(run.status).toBe('WAITING')
    })

    it('allows a transition into RUNNING for a well-formed lesson (baseline: validation does not block valid lessons)', async () => {
      const fake = makeFakeFirestore()
      setUpRun(fake.docs, { status: 'WAITING' })
      const writeCheckpoint = vi.fn().mockResolvedValue({ checkpointId: 'cp-1', deduplicated: false })

      const result = await transitionPhase({
        firestore: fake as never, actorId: 'teacher-1', writeCheckpoint,
      }, { lessonRunId: 'run-1', targetStatus: 'RUNNING', reason: '開始', idempotencyKey: 'tx-11' })

      expect(result.status).toBe('RUNNING')
    })

    it('does not run validateLessonForStart for a phase-only transition (not entering RUNNING)', async () => {
      const fake = makeFakeFirestore()
      setUpRun(fake.docs, {
        status: 'RUNNING',
        currentPhaseId: 'phase-a',
        subject: 'HOME_ECONOMICS',
        templateSnapshot: {
          phases: [
            { id: 'market', type: 'MARKET', progression: 'TIMED', durationSeconds: 60, nextPhaseIds: [], displayConfig: {} },
          ],
        },
      })
      const writeCheckpoint = vi.fn()

      // Even though this lesson would fail validateLessonForStart, moving
      // between phases while already RUNNING is not a start action and must
      // not be blocked by it.
      const result = await transitionPhase({
        firestore: fake as never, actorId: 'teacher-1', writeCheckpoint,
      }, { lessonRunId: 'run-1', targetPhaseId: 'phase-b', reason: '次のフェーズへ', idempotencyKey: 'tx-12' })

      expect(result.currentPhaseId).toBe('phase-b')
    })
  })

  describe('lifecycle timestamps (startedAt / endedAt)', () => {
    it('sets startedAt when transitioning into RUNNING if startedAt is null/absent', async () => {
      const fake = makeFakeFirestore()
      setUpRun(fake.docs, { status: 'WAITING', startedAt: null, endedAt: null })
      const writeCheckpoint = vi.fn().mockResolvedValue({ checkpointId: 'cp-1', deduplicated: false })

      await transitionPhase({
        firestore: fake as never, actorId: 'teacher-1', writeCheckpoint, now: () => '2026-08-15T10:00:00Z',
      }, { lessonRunId: 'run-1', targetStatus: 'RUNNING', reason: '開始', idempotencyKey: 'tx-start-1' })

      const run = fake.docs.get('lessonRuns/run-1') as Record<string, unknown>
      expect(run.startedAt).toBe('2026-08-15T10:00:00Z')
      expect(run.endedAt).toBeNull()
    })

    it('does not overwrite an existing startedAt when resuming RUNNING from PAUSED', async () => {
      const fake = makeFakeFirestore()
      setUpRun(fake.docs, { status: 'PAUSED', startedAt: '2026-08-15T09:00:00Z', endedAt: null })
      const writeCheckpoint = vi.fn().mockResolvedValue({ checkpointId: 'cp-1', deduplicated: false })

      await transitionPhase({
        firestore: fake as never, actorId: 'teacher-1', writeCheckpoint, now: () => '2026-08-15T10:00:00Z',
      }, { lessonRunId: 'run-1', targetStatus: 'RUNNING', reason: '再開', idempotencyKey: 'tx-start-2' })

      const run = fake.docs.get('lessonRuns/run-1') as Record<string, unknown>
      expect(run.startedAt).toBe('2026-08-15T09:00:00Z')
      expect(run.endedAt).toBeNull()
    })

    it('sets endedAt when transitioning from REFLECTION to COMPLETED', async () => {
      const fake = makeFakeFirestore()
      setUpRun(fake.docs, { status: 'REFLECTION', startedAt: '2026-08-15T09:00:00Z', endedAt: null })

      await transitionPhase({
        firestore: fake as never, actorId: 'teacher-1', writeCheckpoint: vi.fn(), now: () => '2026-08-15T11:00:00Z',
      }, { lessonRunId: 'run-1', targetStatus: 'COMPLETED', reason: '完了', idempotencyKey: 'tx-end-1' })

      const run = fake.docs.get('lessonRuns/run-1') as Record<string, unknown>
      expect(run.startedAt).toBe('2026-08-15T09:00:00Z')
      expect(run.endedAt).toBe('2026-08-15T11:00:00Z')
    })

    it.each(['WAITING', 'RUNNING', 'PAUSED', 'INTERRUPTED'] as const)(
      'sets endedAt when transitioning from %s to ABORTED',
      async (fromStatus) => {
        const fake = makeFakeFirestore()
        setUpRun(fake.docs, { status: fromStatus, startedAt: fromStatus === 'WAITING' ? null : '2026-08-15T09:00:00Z', endedAt: null })

        await transitionPhase({
          firestore: fake as never, actorId: 'teacher-1', writeCheckpoint: vi.fn(), now: () => '2026-08-15T12:00:00Z',
        }, { lessonRunId: 'run-1', targetStatus: 'ABORTED', reason: '中止', idempotencyKey: `tx-abort-${fromStatus}` })

        const run = fake.docs.get('lessonRuns/run-1') as Record<string, unknown>
        expect(run.endedAt).toBe('2026-08-15T12:00:00Z')
      },
    )

    it('does not set startedAt or endedAt on other transitions (e.g. RUNNING -> PAUSED, PAUSED -> INTERRUPTED, RUNNING -> REFLECTION)', async () => {
      const fake = makeFakeFirestore()
      setUpRun(fake.docs, { status: 'RUNNING', startedAt: '2026-08-15T09:00:00Z', endedAt: null })
      const writeCheckpoint = vi.fn().mockResolvedValue({ checkpointId: 'cp-1', deduplicated: false })

      await transitionPhase({
        firestore: fake as never, actorId: 'teacher-1', writeCheckpoint, now: () => '2026-08-15T09:30:00Z',
      }, { lessonRunId: 'run-1', targetStatus: 'PAUSED', reason: '一時停止', idempotencyKey: 'tx-pause-1' })

      const run = fake.docs.get('lessonRuns/run-1') as Record<string, unknown>
      expect(run.startedAt).toBe('2026-08-15T09:00:00Z')
      expect(run.endedAt).toBeNull()
    })

    it('does not re-update timestamps on idempotency retry', async () => {
      const fake = makeFakeFirestore()
      setUpRun(fake.docs, { status: 'WAITING', startedAt: null, endedAt: null })
      const writeCheckpoint = vi.fn().mockResolvedValue({ checkpointId: 'cp-1', deduplicated: false })
      let currentTime = '2026-08-15T10:00:00Z'

      const deps = { firestore: fake as never, actorId: 'teacher-1', writeCheckpoint, now: () => currentTime }
      const input = { lessonRunId: 'run-1', targetStatus: 'RUNNING' as const, reason: '開始', idempotencyKey: 'tx-idem-time' }

      await transitionPhase(deps, input)
      currentTime = '2026-08-15T10:05:00Z'
      await transitionPhase(deps, input)

      const run = fake.docs.get('lessonRuns/run-1') as Record<string, unknown>
      expect(run.startedAt).toBe('2026-08-15T10:00:00Z')
    })
  })

  describe('publishResearchDeskProjection hook', () => {
    it('calls publishResearchDeskProjection after successful transition commit', async () => {
      const fake = makeFakeFirestore()
      setUpRun(fake.docs, { status: 'WAITING' })
      const publishResearchDeskProjection = vi.fn().mockResolvedValue(undefined)
      const deps = {
        firestore: fake as never,
        actorId: 'teacher-1',
        writeCheckpoint: vi.fn().mockResolvedValue({ checkpointId: 'cp-1', deduplicated: false }),
        publishResearchDeskProjection,
      }

      await transitionPhase(deps, {
        lessonRunId: 'run-1', targetStatus: 'RUNNING', reason: '開始', idempotencyKey: 'tx-pub-1',
      })

      expect(publishResearchDeskProjection).toHaveBeenCalledTimes(1)
      expect(publishResearchDeskProjection).toHaveBeenCalledWith('run-1')
    })

    it('does NOT call publishResearchDeskProjection when transaction fails', async () => {
      const fake = makeFakeFirestore()
      setUpRun(fake.docs, { status: 'COMPLETED' })
      const publishResearchDeskProjection = vi.fn().mockResolvedValue(undefined)
      const deps = {
        firestore: fake as never,
        actorId: 'teacher-1',
        writeCheckpoint: vi.fn(),
        publishResearchDeskProjection,
      }

      await expect(transitionPhase(deps, {
        lessonRunId: 'run-1', targetStatus: 'RUNNING', reason: '無効', idempotencyKey: 'tx-pub-2',
      })).rejects.toThrow()

      expect(publishResearchDeskProjection).not.toHaveBeenCalled()
    })
  })

  // Task 3: the generic `prepareStatusTransition`/`afterStatusTransition`
  // hook slots themselves — the household-specific logic they carry in
  // production lives in homeEconomics/statusTransition.test.ts; these tests
  // only verify the GENERIC engine's contract (when the hook runs, that its
  // reads happen inside the read phase, that its returned writes commit
  // atomically with LessonRun.status, and that the post-commit hook fires
  // even on a deduplicated replay).
  describe('prepareStatusTransition / afterStatusTransition hooks', () => {
    it('calls prepareStatusTransition (read-phase, before any write) and commits its returned writes atomically with LessonRun.status', async () => {
      const fake = makeFakeFirestore()
      setUpRun(fake.docs, { status: 'WAITING' })
      const callOrder: string[] = []
      const prepareStatusTransition = vi.fn(async (
        tx: Parameters<NonNullable<Parameters<typeof transitionPhase>[0]['prepareStatusTransition']>>[0],
        input: Parameters<NonNullable<Parameters<typeof transitionPhase>[0]['prepareStatusTransition']>>[1],
      ) => {
        callOrder.push('prepare')
        // Exercise a getCollection read to prove it is legal here (still
        // inside the read phase — no write has happened yet in this
        // transaction).
        await tx.getCollection?.('lessonRuns/run-1/someCollection')
        expect(input.targetStatus).toBe('RUNNING')
        return { writes: [{ path: 'lessonRuns/run-1/householdRuntime/control', data: { roundStatus: 'OPEN' } }] }
      })
      const writeCheckpoint = vi.fn(async () => { callOrder.push('checkpoint'); return { checkpointId: 'cp-1', deduplicated: false } })

      const result = await transitionPhase({
        firestore: fake as never, actorId: 'teacher-1', writeCheckpoint, prepareStatusTransition,
      }, { lessonRunId: 'run-1', targetStatus: 'RUNNING', reason: '開始', idempotencyKey: 'tx-hook-1' })

      expect(result.status).toBe('RUNNING')
      expect(prepareStatusTransition).toHaveBeenCalledTimes(1)
      expect(callOrder).toEqual(['prepare', 'checkpoint'])
      const control = fake.docs.get('lessonRuns/run-1/householdRuntime/control')
      expect(control).toEqual({ roundStatus: 'OPEN' })
      // The prepared write and the LessonRun status write must both be
      // present after the SAME transaction — proving they committed
      // atomically together (this fake only ever has one runTransaction
      // call for a non-replayed request, so both existing is sufficient
      // evidence they were part of the same commit).
      const run = fake.docs.get('lessonRuns/run-1') as Record<string, unknown>
      expect(run.status).toBe('RUNNING')
    })

    it('does not call prepareStatusTransition for a phase-only transition', async () => {
      const fake = makeFakeFirestore()
      setUpRun(fake.docs, { status: 'RUNNING', currentPhaseId: 'phase-a' })
      const prepareStatusTransition = vi.fn().mockResolvedValue(null)

      await transitionPhase({
        firestore: fake as never, actorId: 'teacher-1', writeCheckpoint: vi.fn(), prepareStatusTransition,
      }, { lessonRunId: 'run-1', targetPhaseId: 'phase-b', reason: '次のフェーズへ', idempotencyKey: 'tx-hook-2' })

      expect(prepareStatusTransition).not.toHaveBeenCalled()
    })

    it('applies no extra writes when prepareStatusTransition returns null', async () => {
      const fake = makeFakeFirestore()
      setUpRun(fake.docs, { status: 'WAITING' })
      const prepareStatusTransition = vi.fn().mockResolvedValue(null)
      const writeCheckpoint = vi.fn().mockResolvedValue({ checkpointId: 'cp-1', deduplicated: false })

      const result = await transitionPhase({
        firestore: fake as never, actorId: 'teacher-1', writeCheckpoint, prepareStatusTransition,
      }, { lessonRunId: 'run-1', targetStatus: 'RUNNING', reason: '開始', idempotencyKey: 'tx-hook-3' })

      expect(result.status).toBe('RUNNING')
      expect(fake.docs.has('lessonRuns/run-1/householdRuntime/control')).toBe(false)
    })

    it('a failed transaction (e.g. prepareStatusTransition throws) never commits the LessonRun.status write either', async () => {
      const fake = makeFakeFirestore()
      setUpRun(fake.docs, { status: 'WAITING' })
      const prepareStatusTransition = vi.fn().mockRejectedValue(new Error('HouseholdAssignment is not ready to start: X'))

      await expect(transitionPhase({
        firestore: fake as never, actorId: 'teacher-1', writeCheckpoint: vi.fn(), prepareStatusTransition,
      }, { lessonRunId: 'run-1', targetStatus: 'RUNNING', reason: '開始', idempotencyKey: 'tx-hook-4' }))
        .rejects.toThrow('HouseholdAssignment is not ready to start')

      const run = fake.docs.get('lessonRuns/run-1') as Record<string, unknown>
      expect(run.status).toBe('WAITING')
    })

    it('invokes afterStatusTransition post-commit, exactly once, with the transition result', async () => {
      const fake = makeFakeFirestore()
      setUpRun(fake.docs, { status: 'WAITING' })
      const afterStatusTransition = vi.fn().mockResolvedValue(undefined)
      const writeCheckpoint = vi.fn().mockResolvedValue({ checkpointId: 'cp-1', deduplicated: false })

      await transitionPhase({
        firestore: fake as never, actorId: 'teacher-1', writeCheckpoint, afterStatusTransition,
      }, { lessonRunId: 'run-1', targetStatus: 'RUNNING', reason: '開始', idempotencyKey: 'tx-hook-5' })

      expect(afterStatusTransition).toHaveBeenCalledTimes(1)
      expect(afterStatusTransition).toHaveBeenCalledWith({ lessonRunId: 'run-1', targetStatus: 'RUNNING', deduplicated: false })
    })

    // Brief requirement: afterStatusTransition must fire even when the
    // transition itself is a deduplicated idempotency replay, so a
    // post-commit side effect (e.g. a future RTDB repair write) that failed
    // on a prior attempt remains retryable.
    it('invokes afterStatusTransition on a deduplicated replay too, with deduplicated: true', async () => {
      const fake = makeFakeFirestore()
      setUpRun(fake.docs, { status: 'WAITING' })
      const afterStatusTransition = vi.fn().mockResolvedValue(undefined)
      const writeCheckpoint = vi.fn().mockResolvedValue({ checkpointId: 'cp-1', deduplicated: false })
      const deps = { firestore: fake as never, actorId: 'teacher-1', writeCheckpoint, afterStatusTransition }
      const input = { lessonRunId: 'run-1', targetStatus: 'RUNNING' as const, reason: '開始', idempotencyKey: 'tx-hook-6' }

      await transitionPhase(deps, input)
      await transitionPhase(deps, input)

      expect(afterStatusTransition).toHaveBeenCalledTimes(2)
      expect(afterStatusTransition).toHaveBeenNthCalledWith(2, { lessonRunId: 'run-1', targetStatus: 'RUNNING', deduplicated: true })
    })

    // Regression (brief): PAUSED -> RUNNING must never re-freeze the
    // household assignment or reset its runtime control — only the very
    // first WAITING -> RUNNING start does. This is verified at the generic
    // engine level: prepareStatusTransition is called on the resume too
    // (the engine has no opinion on WHEN the hook applies), but a
    // household-aware hook (see homeEconomics/statusTransition.test.ts) is
    // expected to return null for it, so no writes get applied.
    it('still calls prepareStatusTransition on PAUSED -> RUNNING (a resume), leaving it to the hook to decide whether to act', async () => {
      const fake = makeFakeFirestore()
      setUpRun(fake.docs, { status: 'PAUSED', startedAt: '2026-08-15T09:00:00Z' })
      const prepareStatusTransition = vi.fn().mockResolvedValue(null)
      const writeCheckpoint = vi.fn().mockResolvedValue({ checkpointId: 'cp-1', deduplicated: false })

      const result = await transitionPhase({
        firestore: fake as never, actorId: 'teacher-1', writeCheckpoint, prepareStatusTransition,
      }, { lessonRunId: 'run-1', targetStatus: 'RUNNING', reason: '再開', idempotencyKey: 'tx-hook-7' })

      expect(result.status).toBe('RUNNING')
      expect(prepareStatusTransition).toHaveBeenCalledTimes(1)
      const [, hookInput] = prepareStatusTransition.mock.calls[0]
      expect((hookInput as { run: { startedAt: unknown } }).run.startedAt).toBe('2026-08-15T09:00:00Z')
      expect(fake.docs.has('lessonRuns/run-1/householdRuntime/control')).toBe(false)
    })

    // Task 12: the REFLECTION-gate + final-comparison hook
    // (homeEconomics/statusTransition.ts's `prepareReflectionTransition`)
    // needed ZERO production changes to this file — this generic engine
    // already calls `prepareStatusTransition`/`afterStatusTransition` for
    // ANY `targetStatus`, per the JSDoc above. These two tests exist purely
    // to prove that genericity actually covers REFLECTION end-to-end (write
    // commits atomically with the RUNNING -> REFLECTION status write; the
    // post-commit hook fires with `targetStatus: 'REFLECTION'`), not to add
    // any new engine behavior.
    it('commits a prepareStatusTransition-returned write atomically with a RUNNING -> REFLECTION status transition', async () => {
      const fake = makeFakeFirestore()
      setUpRun(fake.docs, { status: 'RUNNING' })
      const prepareStatusTransition = vi.fn(async (
        _tx: unknown,
        input: { targetStatus: string },
      ) => {
        expect(input.targetStatus).toBe('REFLECTION')
        return { writes: [{ path: 'lessonRuns/run-1/householdFinalComparison/result', data: { finalRoundCount: 6 } }] }
      })
      const writeCheckpoint = vi.fn().mockResolvedValue({ checkpointId: 'cp-1', deduplicated: false })

      const result = await transitionPhase({
        firestore: fake as never, actorId: 'teacher-1', writeCheckpoint, prepareStatusTransition,
      }, { lessonRunId: 'run-1', targetStatus: 'REFLECTION', reason: '振り返りへ', idempotencyKey: 'tx-hook-reflection-1' })

      expect(result.status).toBe('REFLECTION')
      const comparisonWrite = fake.docs.get('lessonRuns/run-1/householdFinalComparison/result')
      expect(comparisonWrite).toEqual({ finalRoundCount: 6 })
      const run = fake.docs.get('lessonRuns/run-1') as Record<string, unknown>
      expect(run.status).toBe('REFLECTION')
    })

    it('invokes afterStatusTransition post-commit for a RUNNING -> REFLECTION transition, including on a deduplicated replay', async () => {
      const fake = makeFakeFirestore()
      setUpRun(fake.docs, { status: 'RUNNING' })
      const afterStatusTransition = vi.fn().mockResolvedValue(undefined)
      const writeCheckpoint = vi.fn().mockResolvedValue({ checkpointId: 'cp-1', deduplicated: false })
      const deps = { firestore: fake as never, actorId: 'teacher-1', writeCheckpoint, afterStatusTransition }
      const input = { lessonRunId: 'run-1', targetStatus: 'REFLECTION' as const, reason: '振り返りへ', idempotencyKey: 'tx-hook-reflection-2' }

      await transitionPhase(deps, input)
      await transitionPhase(deps, input)

      expect(afterStatusTransition).toHaveBeenCalledTimes(2)
      expect(afterStatusTransition).toHaveBeenNthCalledWith(1, { lessonRunId: 'run-1', targetStatus: 'REFLECTION', deduplicated: false })
      expect(afterStatusTransition).toHaveBeenNthCalledWith(2, { lessonRunId: 'run-1', targetStatus: 'REFLECTION', deduplicated: true })
    })
  })
})


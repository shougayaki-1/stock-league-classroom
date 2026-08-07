import { describe, expect, it, vi } from 'vitest'
import { transitionPhase } from './transitionPhase'

// Same fake as teams/assignTeam.test.ts / joinLessonRun.test.ts: enforces
// Firestore Admin SDK's "all reads before all writes" transaction
// constraint so a Task-3-Critical-#1-style ordering bug fails a test
// instead of only failing in production.
const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    runTransaction: async <T>(fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<T>) => {
      let written = false
      return fn({
        get: async (path: string) => {
          if (written) throw new Error('Firestore transactions require all reads to be executed before all writes.')
          return { exists: docs.has(path), data: () => docs.get(path) }
        },
        set: (path: string, data: Record<string, unknown>) => { written = true; docs.set(path, data) },
      })
    },
  }
}

const setUpRun = (docs: Map<string, Record<string, unknown>>, overrides: Record<string, unknown> = {}) => {
  docs.set('lessonRuns/run-1', {
    id: 'run-1', orgId: 'org-1', status: 'WAITING', currentPhaseId: null,
    templateId: 'tpl-1', extraField: 'preserved',
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

  it('throws when neither targetStatus nor targetPhaseId is given', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs)
    await expect(transitionPhase({
      firestore: fake as never, actorId: 'teacher-1', writeCheckpoint: vi.fn(),
    }, { lessonRunId: 'run-1', reason: '何もしない', idempotencyKey: 'tx-8' } as never))
      .rejects.toThrow('Nothing to transition')
  })
})

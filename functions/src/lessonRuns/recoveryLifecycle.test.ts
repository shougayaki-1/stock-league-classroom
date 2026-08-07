import { describe, expect, it, vi } from 'vitest'
import {
  abortLesson,
  completeLesson,
  interruptLesson,
  noopSubjectLifecycleAdapter,
  resumeLesson,
  shouldSkipStaleAsyncTask,
  type SubjectLifecycleAdapter,
} from './recoveryLifecycle'
import { restoreCheckpoint } from './checkpoint'

// Same fake as transitionPhase.test.ts / checkpoint.test.ts: reproduces
// Firestore Admin SDK's "all reads before all writes" per-transaction
// constraint so a Task-3-Critical-#1-style ordering bug fails a test instead
// of only failing in production.
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
        update: (path: string, data: Record<string, unknown>) => { written = true; docs.set(path, { ...docs.get(path), ...data }) },
      })
    },
  }
}

describe('Step 1: completeLesson — 終了順序', () => {
  it('runs stopNewOperations → drainAcceptedOperations → buildFinalResults → writeCheckpoint → REFLECTION transition, in that exact order', async () => {
    const callOrder: string[] = []
    const adapter: SubjectLifecycleAdapter = {
      stopNewOperations: vi.fn(async () => { callOrder.push('stopNewOperations') }),
      drainAcceptedOperations: vi.fn(async () => { callOrder.push('drainAcceptedOperations') }),
      buildSubjectSnapshot: vi.fn(async () => { callOrder.push('buildFinalResults'); return { finalCash: 1000 } }),
    }
    const writeCheckpoint = vi.fn(async () => { callOrder.push('writeCheckpoint'); return { checkpointId: 'cp-final', deduplicated: false } })
    const transitionPhase = vi.fn(async () => { callOrder.push('REFLECTION'); return { status: 'REFLECTION' as const, currentPhaseId: 'reflection', deduplicated: false } })

    const result = await completeLesson({ adapter, writeCheckpoint, transitionPhase, actorId: 'teacher-1' }, {
      lessonRunId: 'run-1', reason: '通常終了', idempotencyKey: 'complete-1',
    })

    expect(callOrder).toEqual(['stopNewOperations', 'drainAcceptedOperations', 'buildFinalResults', 'writeCheckpoint', 'REFLECTION'])
    expect(adapter.stopNewOperations).toHaveBeenCalledWith('run-1')
    expect(adapter.drainAcceptedOperations).toHaveBeenCalledWith('run-1')
    expect(adapter.buildSubjectSnapshot).toHaveBeenCalledWith('run-1')
    expect(writeCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      lessonRunId: 'run-1', snapshot: { finalCash: 1000 },
    }))
    expect(transitionPhase).toHaveBeenCalledWith(expect.objectContaining({ lessonRunId: 'run-1', targetStatus: 'REFLECTION' }))
    expect(result.finalResults).toEqual({ finalCash: 1000 })
    expect(result.checkpointId).toBe('cp-final')
    expect(result.transition.status).toBe('REFLECTION')
  })

  it('uses distinct idempotencyKeys for the explicit final-results checkpoint and the REFLECTION transition (writeCheckpoint is self-contained and cannot dedupe two different snapshots under one key)', async () => {
    const writeCheckpoint = vi.fn().mockResolvedValue({ checkpointId: 'cp-final', deduplicated: false })
    const transitionPhase = vi.fn().mockResolvedValue({ status: 'REFLECTION', currentPhaseId: null, deduplicated: false })

    await completeLesson({ adapter: noopSubjectLifecycleAdapter, writeCheckpoint, transitionPhase, actorId: 'teacher-1' }, {
      lessonRunId: 'run-1', reason: '通常終了', idempotencyKey: 'complete-2',
    })

    const checkpointKey = writeCheckpoint.mock.calls[0][0].idempotencyKey
    const transitionKey = transitionPhase.mock.calls[0][0].idempotencyKey
    expect(checkpointKey).not.toBe(transitionKey)
  })

  it('defaults to the no-op SubjectLifecycleAdapter when none is injected (Phase B has no subject-specific engine yet)', async () => {
    const writeCheckpoint = vi.fn().mockResolvedValue({ checkpointId: 'cp-final', deduplicated: false })
    const transitionPhase = vi.fn().mockResolvedValue({ status: 'REFLECTION', currentPhaseId: null, deduplicated: false })

    const result = await completeLesson({ writeCheckpoint, transitionPhase, actorId: 'teacher-1' }, {
      lessonRunId: 'run-1', reason: '通常終了', idempotencyKey: 'complete-3',
    })

    expect(result.finalResults).toEqual({})
  })
})

describe('Step 1: interruptLesson — 中断理由・暫定結果・再開地点の保存', () => {
  it('transitions RUNNING/PAUSED → INTERRUPTED and records reason, interim results, and resume phase/checkpoint', async () => {
    const transitionPhase = vi.fn().mockResolvedValue({ status: 'INTERRUPTED', currentPhaseId: 'phase-a', deduplicated: false })
    const appendEvent = vi.fn().mockResolvedValue({ eventId: 'run-1_1', sequence: 1, deduplicated: false })

    const result = await interruptLesson({ transitionPhase, appendEvent, actorId: 'teacher-1' }, {
      lessonRunId: 'run-1', orgId: 'org-1', reason: '停電', interimResults: { cash: 500 },
      resumePhaseId: 'phase-a', resumeCheckpointId: 'cp-1', idempotencyKey: 'interrupt-1',
    })

    expect(transitionPhase).toHaveBeenCalledWith(expect.objectContaining({
      lessonRunId: 'run-1', targetStatus: 'INTERRUPTED', reason: '停電',
    }))
    expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({
      lessonRunId: 'run-1', orgId: 'org-1', type: 'LESSON_INTERRUPTED', actorId: 'teacher-1',
      payload: { reason: '停電', interimResults: { cash: 500 }, resumePhaseId: 'phase-a', resumeCheckpointId: 'cp-1' },
    }))
    expect(result.eventId).toBe('run-1_1')
    expect(result.transition.status).toBe('INTERRUPTED')
  })
})

describe('Step 1: resumeLesson — INTERRUPTED → WAITING', () => {
  it('transitions INTERRUPTED to WAITING so a teacher can re-verify connections/teams before the (separate) WAITING → RUNNING step', async () => {
    const transitionPhase = vi.fn().mockResolvedValue({ status: 'WAITING', currentPhaseId: 'phase-a', deduplicated: false })

    const result = await resumeLesson({ transitionPhase, actorId: 'teacher-1' }, {
      lessonRunId: 'run-1', reason: '再開準備完了', idempotencyKey: 'resume-1',
    })

    expect(transitionPhase).toHaveBeenCalledWith(expect.objectContaining({
      lessonRunId: 'run-1', targetStatus: 'WAITING', reason: '再開準備完了',
    }))
    expect(result.status).toBe('WAITING')
  })
})

describe('Step 1: abortLesson — 打切りが未実施フェーズを評価対象外にする', () => {
  it('transitions to ABORTED and freezes only the already-completed phases as the evaluated set', async () => {
    const transitionPhase = vi.fn().mockResolvedValue({ status: 'ABORTED', currentPhaseId: 'phase-b', deduplicated: false })
    const appendEvent = vi.fn().mockResolvedValue({ eventId: 'run-1_2', sequence: 2, deduplicated: false })

    const result = await abortLesson({ transitionPhase, appendEvent, actorId: 'teacher-1' }, {
      lessonRunId: 'run-1', orgId: 'org-1', reason: '機材故障',
      completedPhaseIds: ['phase-a'], idempotencyKey: 'abort-1',
    })

    expect(transitionPhase).toHaveBeenCalledWith(expect.objectContaining({
      lessonRunId: 'run-1', targetStatus: 'ABORTED', reason: '機材故障',
    }))
    expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'LESSON_ABORTED',
      payload: { reason: '機材故障', evaluatedPhaseIds: ['phase-a'] },
    }))
    expect(result.transition.status).toBe('ABORTED')
    expect(result.eventId).toBe('run-1_2')
  })
})

describe('Step 4: no-op SubjectLifecycleAdapter (Phase B default; Phase C/D register their own)', () => {
  it('resolves stopNewOperations/drainAcceptedOperations immediately and returns an empty snapshot', async () => {
    await expect(noopSubjectLifecycleAdapter.stopNewOperations('run-1')).resolves.toBeUndefined()
    await expect(noopSubjectLifecycleAdapter.drainAcceptedOperations('run-1')).resolves.toBeUndefined()
    await expect(noopSubjectLifecycleAdapter.buildSubjectSnapshot('run-1')).resolves.toEqual({})
  })
})

describe('Step 2: 復旧世代 — restoreCheckpoint 復元で restoreGeneration が増え、元イベントを削除しない', () => {
  it('restoring a checkpoint bumps restoreGeneration without touching existing events', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { restoreGeneration: 0, orgId: 'org-1' })
    fake.docs.set('lessonRuns/run-1/checkpoints/cp-1', { id: 'cp-1', sequence: 5, restoreGeneration: 0 })
    fake.docs.set('lessonRuns/run-1/events/run-1_0', { eventId: 'run-1_0', sequence: 0, type: 'LESSON_STATUS_CHANGED' })

    const result = await restoreCheckpoint({
      firestore: fake as never, lessonRunId: 'run-1', checkpointId: 'cp-1',
      reason: '巻き戻し', actorId: 'teacher-1', idempotencyKey: 'restore-1',
    })

    expect(result.newRestoreGeneration).toBe(1)
    expect(fake.docs.get('lessonRuns/run-1')).toMatchObject({ restoreGeneration: 1 })
    // The pre-existing event is still there, untouched — restore is append-only.
    expect(fake.docs.get('lessonRuns/run-1/events/run-1_0')).toMatchObject({ eventId: 'run-1_0' })
  })
})

describe('Step 2: 復旧世代 — 古い世代の非同期処理を無視する', () => {
  it('shouldSkipStaleAsyncTask reports true once restoreGeneration has moved on from the task\'s captured generation', () => {
    expect(shouldSkipStaleAsyncTask(0, 0)).toBe(false)
    expect(shouldSkipStaleAsyncTask(0, 1)).toBe(true)
    expect(shouldSkipStaleAsyncTask(1, 1)).toBe(false)
  })

  it('demonstrates the pattern: a mock async task guarded by shouldSkipStaleAsyncTask no-ops once the lesson has been restored to a newer generation', async () => {
    let currentRestoreGeneration = 0
    const applyResult = vi.fn()

    // Simulates a Phase C market-engine async task that captured
    // restoreGeneration=0 at dispatch time, but the lesson gets restored
    // (bumping the generation) before the task actually runs.
    const staleAsyncMarketTask = async (taskRestoreGeneration: number) => {
      if (shouldSkipStaleAsyncTask(taskRestoreGeneration, currentRestoreGeneration)) return
      applyResult()
    }

    const dispatchedAtGeneration = currentRestoreGeneration
    currentRestoreGeneration = 1 // a restore happened before the task ran
    await staleAsyncMarketTask(dispatchedAtGeneration)
    expect(applyResult).not.toHaveBeenCalled()

    // A task dispatched at the current generation still runs normally.
    await staleAsyncMarketTask(currentRestoreGeneration)
    expect(applyResult).toHaveBeenCalledTimes(1)
  })
})

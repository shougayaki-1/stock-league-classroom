import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

// Same module-boundary mock as checkpoint.test.ts / transitionPhase.test.ts:
// the literal SDK `httpsCallable(functions, name)` reaches into the real
// Functions instance's internals, so a plain fake `functions` object throws
// at runtime.
const callable = vi.fn()
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { abortLesson, completeLesson, interruptLesson, resumeLesson } = await import('./lifecycle')

describe('interruptLesson (client)', () => {
  it('calls interruptLessonCallable with the given fields', async () => {
    callable.mockResolvedValue({ data: { transition: { status: 'INTERRUPTED', currentPhaseId: 'phase-a', deduplicated: false }, eventId: 'run-1_1' } })
    const functions = {} as Functions

    const result = await interruptLesson(functions, {
      lessonRunId: 'run-1', reason: '停電', interimResults: { cash: 500 },
      resumePhaseId: 'phase-a', resumeCheckpointId: 'cp-1', idempotencyKey: 'interrupt-1',
    })

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'interruptLessonCallable')
    expect(callable).toHaveBeenCalledWith({
      lessonRunId: 'run-1', reason: '停電', interimResults: { cash: 500 },
      resumePhaseId: 'phase-a', resumeCheckpointId: 'cp-1', idempotencyKey: 'interrupt-1',
    })
    expect(result.eventId).toBe('run-1_1')
  })
})

describe('resumeLesson (client)', () => {
  it('calls resumeLessonCallable with lessonRunId/reason/idempotencyKey', async () => {
    callable.mockResolvedValue({ data: { status: 'WAITING', currentPhaseId: 'phase-a', deduplicated: false } })
    const functions = {} as Functions

    const result = await resumeLesson(functions, { lessonRunId: 'run-1', reason: '再開準備完了', idempotencyKey: 'resume-1' })

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'resumeLessonCallable')
    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1', reason: '再開準備完了', idempotencyKey: 'resume-1' })
    expect(result.status).toBe('WAITING')
  })
})

describe('completeLesson (client)', () => {
  it('calls completeLessonCallable with lessonRunId/reason/idempotencyKey', async () => {
    callable.mockResolvedValue({
      data: { finalResults: { finalCash: 1000 }, checkpointId: 'cp-final', transition: { status: 'REFLECTION', currentPhaseId: null, deduplicated: false } },
    })
    const functions = {} as Functions

    const result = await completeLesson(functions, { lessonRunId: 'run-1', reason: '通常終了', idempotencyKey: 'complete-1' })

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'completeLessonCallable')
    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1', reason: '通常終了', idempotencyKey: 'complete-1' })
    expect(result.checkpointId).toBe('cp-final')
  })
})

describe('abortLesson (client)', () => {
  it('calls abortLessonCallable with lessonRunId/reason/completedPhaseIds/idempotencyKey', async () => {
    callable.mockResolvedValue({ data: { transition: { status: 'ABORTED', currentPhaseId: 'phase-b', deduplicated: false }, eventId: 'run-1_2' } })
    const functions = {} as Functions

    const result = await abortLesson(functions, {
      lessonRunId: 'run-1', reason: '機材故障', completedPhaseIds: ['phase-a'], idempotencyKey: 'abort-1',
    })

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'abortLessonCallable')
    expect(callable).toHaveBeenCalledWith({
      lessonRunId: 'run-1', reason: '機材故障', completedPhaseIds: ['phase-a'], idempotencyKey: 'abort-1',
    })
    expect(result.eventId).toBe('run-1_2')
  })
})

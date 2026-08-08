import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

// Same module-boundary mock as transitionPhase.test.ts/checkpoint.test.ts:
// `httpsCallable(functions, name)` reaches into the real Functions
// instance's internals, so a plain fake `functions` object throws at
// runtime — mock the module boundary instead.
const callable = vi.fn()
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { transferPrimaryTeacher, applyTeacherIntervention } = await import('./interventions')

describe('transferPrimaryTeacher (client)', () => {
  it('calls transferPrimaryTeacherCallable with lessonRunId/newPrimaryTeacherUid/reason/idempotencyKey', async () => {
    callable.mockResolvedValueOnce({ data: { previousPrimaryTeacherUid: 'teacher-1', newPrimaryTeacherUid: 'teacher-2', deduplicated: false } })
    const functions = {} as Functions
    const result = await transferPrimaryTeacher(functions, {
      lessonRunId: 'run-1', newPrimaryTeacherUid: 'teacher-2', reason: '体調不良', idempotencyKey: 'transfer-1',
    })
    expect(result).toEqual({ previousPrimaryTeacherUid: 'teacher-1', newPrimaryTeacherUid: 'teacher-2', deduplicated: false })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'transferPrimaryTeacherCallable')
    expect(callable).toHaveBeenCalledWith({
      lessonRunId: 'run-1', newPrimaryTeacherUid: 'teacher-2', reason: '体調不良', idempotencyKey: 'transfer-1',
    })
  })
})

describe('applyTeacherIntervention (client)', () => {
  it('calls applyTeacherInterventionCallable with the full intervention envelope', async () => {
    callable.mockResolvedValueOnce({ data: { type: 'SWITCH_DISPLAY_SLIDE', eventId: 'ev-1', deduplicated: false } })
    const functions = {} as Functions
    const result = await applyTeacherIntervention(functions, {
      lessonRunId: 'run-1',
      type: 'SWITCH_DISPLAY_SLIDE',
      reason: '次のスライドへ',
      before: { slideId: 'slide-1' },
      after: { slideId: 'slide-2' },
      impactScope: { level: 'LESSON' },
      detail: { slideId: 'slide-2' },
      idempotencyKey: 'intervention-1',
    })
    expect(result).toEqual({ type: 'SWITCH_DISPLAY_SLIDE', eventId: 'ev-1', deduplicated: false })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'applyTeacherInterventionCallable')
    expect(callable).toHaveBeenCalledWith({
      lessonRunId: 'run-1',
      type: 'SWITCH_DISPLAY_SLIDE',
      reason: '次のスライドへ',
      before: { slideId: 'slide-1' },
      after: { slideId: 'slide-2' },
      impactScope: { level: 'LESSON' },
      detail: { slideId: 'slide-2' },
      idempotencyKey: 'intervention-1',
    })
  })
})

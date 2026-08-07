import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

// Same module-boundary mock as checkpoint.test.ts: `httpsCallable(functions, name)`
// reaches into the real Functions instance's internals, so a plain fake
// `functions` object throws at runtime.
const callable = vi.fn().mockResolvedValue({ data: { status: 'RUNNING', currentPhaseId: 'phase-a', deduplicated: false } })
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { transitionPhase } = await import('./transitionPhase')

describe('transitionPhase (client)', () => {
  it('calls the transitionPhaseCallable callable with lessonRunId/targetStatus/targetPhaseId/reason/idempotencyKey', async () => {
    const functions = {} as Functions
    const result = await transitionPhase(functions, {
      lessonRunId: 'run-1', targetStatus: 'RUNNING', targetPhaseId: 'phase-a', reason: '開始', idempotencyKey: 'tx-1',
    })
    expect(result).toEqual({ status: 'RUNNING', currentPhaseId: 'phase-a', deduplicated: false })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'transitionPhaseCallable')
    expect(callable).toHaveBeenCalledWith({
      lessonRunId: 'run-1', targetStatus: 'RUNNING', targetPhaseId: 'phase-a', reason: '開始', idempotencyKey: 'tx-1',
    })
  })

  it('omits targetStatus/targetPhaseId from the request when not supplied', async () => {
    const functions = {} as Functions
    await transitionPhase(functions, { lessonRunId: 'run-1', targetPhaseId: 'phase-b', reason: '次へ', idempotencyKey: 'tx-2' })
    expect(callable).toHaveBeenCalledWith({
      lessonRunId: 'run-1', targetPhaseId: 'phase-b', reason: '次へ', idempotencyKey: 'tx-2',
    })
  })
})

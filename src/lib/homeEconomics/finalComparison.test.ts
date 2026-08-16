import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

// Same module-boundary mock as submitDecision.test.ts: `httpsCallable`
// reaches into the real Functions instance's internals, so a plain fake
// `functions` object throws at runtime.
const callable = vi.fn()
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { showHouseholdComparisonOnDisplay } = await import('./finalComparison')

describe('showHouseholdComparisonOnDisplay (client)', () => {
  it('calls showHouseholdComparisonOnDisplayCallable with ONLY lessonRunId — never a comparison payload', async () => {
    callable.mockResolvedValue({ data: undefined })
    const functions = {} as Functions

    await showHouseholdComparisonOnDisplay(functions, { lessonRunId: 'run-1' })

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'showHouseholdComparisonOnDisplayCallable')
    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1' })
    expect(callable).toHaveBeenCalledWith(expect.not.objectContaining({ householdClassComparison: expect.anything() }))
  })

  it('propagates a rejected Callable (e.g. failed-precondition when no snapshot exists yet)', async () => {
    callable.mockRejectedValue(new Error('failed-precondition'))
    const functions = {} as Functions

    await expect(showHouseholdComparisonOnDisplay(functions, { lessonRunId: 'run-1' })).rejects.toThrow('failed-precondition')
  })
})

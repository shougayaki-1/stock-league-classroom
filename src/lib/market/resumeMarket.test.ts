import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

// Same module-boundary mock as pauseMarket.test.ts: `httpsCallable(functions,
// name)` reaches into the real Functions instance's internals, so a plain
// fake `functions` object throws at runtime.
const callable = vi.fn()
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { resumeMarket } = await import('./resumeMarket')

describe('resumeMarket (client)', () => {
  it('calls resumeMarketCallable with the given lessonRunId', async () => {
    callable.mockResolvedValue({ data: undefined })
    const functions = {} as Functions

    await resumeMarket(functions, { lessonRunId: 'run-1' })

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'resumeMarketCallable')
    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1' })
  })

  it('passes an explicit confirmationSeconds override through', async () => {
    callable.mockResolvedValue({ data: undefined })
    const functions = {} as Functions

    await resumeMarket(functions, { lessonRunId: 'run-1', confirmationSeconds: 0 })

    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1', confirmationSeconds: 0 })
  })
})

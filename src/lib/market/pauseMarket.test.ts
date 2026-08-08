import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

// Same module-boundary mock as cancelOrder.test.ts: `httpsCallable(functions,
// name)` reaches into the real Functions instance's internals, so a plain
// fake `functions` object throws at runtime.
const callable = vi.fn()
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { pauseMarket } = await import('./pauseMarket')

describe('pauseMarket (client)', () => {
  it('calls pauseMarketCallable with the given lessonRunId', async () => {
    callable.mockResolvedValue({ data: undefined })
    const functions = {} as Functions

    await pauseMarket(functions, { lessonRunId: 'run-1' })

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'pauseMarketCallable')
    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1' })
  })
})

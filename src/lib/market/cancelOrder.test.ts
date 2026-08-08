import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

// Same module-boundary mock as submitOrder.test.ts: `httpsCallable(functions,
// name)` reaches into the real Functions instance's internals, so a plain
// fake `functions` object throws at runtime.
const callable = vi.fn()
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { cancelOrder } = await import('./cancelOrder')

describe('cancelOrder (client)', () => {
  it('calls cancelOrderCallable with the given fields', async () => {
    callable.mockResolvedValue({ data: undefined })
    const functions = {} as Functions

    await cancelOrder(functions, { lessonRunId: 'run-1', orderId: 'order-1' })

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'cancelOrderCallable')
    expect(callable).toHaveBeenCalledWith({ lessonRunId: 'run-1', orderId: 'order-1' })
  })
})

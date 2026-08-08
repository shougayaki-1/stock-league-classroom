import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

// Same module-boundary mock as transitionPhase.test.ts / lifecycle.test.ts:
// `httpsCallable(functions, name)` reaches into the real Functions
// instance's internals, so a plain fake `functions` object throws at runtime.
const callable = vi.fn()
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { submitOrder } = await import('./submitOrder')

describe('submitOrder (client)', () => {
  it('calls submitOrderCallable with the given fields', async () => {
    callable.mockResolvedValue({ data: { orderId: 'order-1', created: true } })
    const functions = {} as Functions

    const result = await submitOrder(functions, {
      lessonRunId: 'run-1', batchId: 'batch-3', teamId: 'team-a', stockId: 'acme',
      side: 'BUY', quantity: 5, referencePrice: 1000, idempotencyKey: 'idem-1',
    })

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'submitOrderCallable')
    expect(callable).toHaveBeenCalledWith({
      lessonRunId: 'run-1', batchId: 'batch-3', teamId: 'team-a', stockId: 'acme',
      side: 'BUY', quantity: 5, referencePrice: 1000, idempotencyKey: 'idem-1',
    })
    expect(result).toEqual({ orderId: 'order-1', created: true })
  })
})

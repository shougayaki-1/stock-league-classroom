import { describe, expect, it, vi } from 'vitest'
import { cancelOrder } from './cancelOrder'

describe('cancelOrder', () => {
  it('releases the soft lock and transitions the order to CANCELLED, in that order', async () => {
    const releaseSoftLock = vi.fn()
    const transition = vi.fn()
    await cancelOrder({
      getOrder: async () => ({
        orderId: 'order-1', status: 'PENDING' as const, side: 'BUY' as const,
        stockId: 'acme', quantity: 5, referencePrice: 1000, teamId: 'team-a', lessonRunId: 'run-1',
      }),
      releaseSoftLock, transition,
      lessonRunId: 'run-1', orderId: 'order-1',
    })
    expect(releaseSoftLock).toHaveBeenCalledWith(expect.objectContaining({ quantity: 5, referencePrice: 1000 }))
    expect(transition).toHaveBeenCalledWith(expect.objectContaining({ from: 'PENDING', to: 'CANCELLED' }))
  })

  it('refuses to cancel an order that already moved to PROCESSING (spec §12.17)', async () => {
    const releaseSoftLock = vi.fn()
    const transition = vi.fn()
    await expect(cancelOrder({
      getOrder: async () => ({
        orderId: 'order-1', status: 'PROCESSING' as const, side: 'BUY' as const,
        stockId: 'acme', quantity: 5, referencePrice: 1000, teamId: 'team-a', lessonRunId: 'run-1',
      }),
      releaseSoftLock, transition,
      lessonRunId: 'run-1', orderId: 'order-1',
    })).rejects.toThrow('処理中の注文は取消できません')
    expect(releaseSoftLock).not.toHaveBeenCalled()
    expect(transition).not.toHaveBeenCalled()
  })
})

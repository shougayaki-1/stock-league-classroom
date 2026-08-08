import { describe, expect, it, vi } from 'vitest'
import { submitOrder } from './submitOrder'

describe('submitOrder', () => {
  it('rejects when the market is paused (spec §12.25)', async () => {
    const applySoftLock = vi.fn()
    const createOrder = vi.fn()
    await expect(submitOrder({
      isMarketAcceptingOrders: () => false,
      applySoftLock, createOrder,
      lessonRunId: 'run-1', batchId: 'batch-3', teamId: 'team-a', stockId: 'acme',
      side: 'BUY', quantity: 5, referencePrice: 1000, idempotencyKey: 'idem-1',
    })).rejects.toThrow('市場は停止中です')
    expect(applySoftLock).not.toHaveBeenCalled()
    expect(createOrder).not.toHaveBeenCalled()
  })

  it('creates the order only after the soft lock is accepted', async () => {
    const applySoftLock = vi.fn().mockResolvedValue({ accepted: true })
    const createOrder = vi.fn().mockResolvedValue({ orderId: 'order-1', created: true })
    const result = await submitOrder({
      isMarketAcceptingOrders: () => true,
      applySoftLock, createOrder,
      lessonRunId: 'run-1', batchId: 'batch-3', teamId: 'team-a', stockId: 'acme',
      side: 'BUY', quantity: 5, referencePrice: 1000, idempotencyKey: 'idem-1',
    })
    expect(result).toEqual({ orderId: 'order-1', created: true })
    expect(applySoftLock).toHaveBeenCalledBefore(createOrder as never)
  })

  it('propagates a soft-lock rejection without creating an order', async () => {
    const applySoftLock = vi.fn().mockResolvedValue({ accepted: false, reason: '利用可能現金が不足しています。' })
    const createOrder = vi.fn()
    await expect(submitOrder({
      isMarketAcceptingOrders: () => true,
      applySoftLock, createOrder,
      lessonRunId: 'run-1', batchId: 'batch-3', teamId: 'team-a', stockId: 'acme',
      side: 'BUY', quantity: 5, referencePrice: 1000, idempotencyKey: 'idem-1',
    })).rejects.toThrow('利用可能現金が不足しています。')
    expect(createOrder).not.toHaveBeenCalled()
  })
})

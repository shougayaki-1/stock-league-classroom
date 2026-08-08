import { describe, expect, it } from 'vitest'
import { createPendingOrder, getOrder, listPendingOrdersForBatch, transitionOrderStatus } from './repository'

// Same "all reads before all writes" fake as interventions.test.ts /
// checkpoint.test.ts / recoveryLifecycle.test.ts — added after Task 3's
// Critical #1 production incident so a read-after-write ordering bug fails
// a test instead of only failing in production.
const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    runTransaction: async <T>(fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (path: string, data: Record<string, unknown>) => void
      update: (path: string, data: Record<string, unknown>) => void
    }) => Promise<T>) => {
      let written = false
      return fn({
        get: async (path: string) => {
          if (written) throw new Error('Firestore transactions require all reads to be executed before all writes.')
          return { exists: docs.has(path), data: () => docs.get(path) }
        },
        set: (path: string, data: Record<string, unknown>) => { written = true; docs.set(path, data) },
        update: (path: string, data: Record<string, unknown>) => {
          written = true
          const existing = docs.get(path) ?? {}
          docs.set(path, { ...existing, ...data })
        },
      })
    },
    getDoc: async (path: string) => ({ exists: docs.has(path), data: () => docs.get(path) }),
    queryOrders: async (lessonRunId: string, batchId: string, status: string) => Array.from(docs.entries())
      .filter(([path, data]) => path.startsWith(`lessonRuns/${lessonRunId}/orders/`) && data.batchId === batchId && data.status === status)
      .map(([, data]) => data),
  }
}

describe('createPendingOrder', () => {
  it('creates a PENDING order and soft-locks nothing itself (Task 6 owns locking)', async () => {
    const fake = makeFakeFirestore()
    const result = await createPendingOrder({
      firestore: fake as never, lessonRunId: 'run-1', batchId: 'batch-3',
      teamId: 'team-a', stockId: 'acme', side: 'BUY', quantity: 5, referencePrice: 1000,
      idempotencyKey: 'order-idem-1', now: () => 1000,
    })
    expect(result.created).toBe(true)
    expect(fake.docs.get(`lessonRuns/run-1/orders/${result.orderId}`)).toMatchObject({
      status: 'PENDING', batchId: 'batch-3', side: 'BUY', quantity: 5,
    })
  })

  it('is idempotent per idempotencyKey: a retried submission does not create a second order', async () => {
    const fake = makeFakeFirestore()
    const input = {
      firestore: fake as never, lessonRunId: 'run-1', batchId: 'batch-3',
      teamId: 'team-a', stockId: 'acme', side: 'BUY' as const, quantity: 5, referencePrice: 1000,
      idempotencyKey: 'order-idem-1', now: () => 1000,
    }
    const first = await createPendingOrder(input)
    const second = await createPendingOrder(input)
    expect(second.orderId).toBe(first.orderId)
    expect(second.created).toBe(false)
    expect(Array.from(fake.docs.keys()).filter((path) => path.startsWith('lessonRuns/run-1/orders/')).length).toBe(1)
  })

  it('rejects reusing the same idempotencyKey for a materially different order', async () => {
    const fake = makeFakeFirestore()
    const base = {
      firestore: fake as never, lessonRunId: 'run-1', batchId: 'batch-3',
      teamId: 'team-a', stockId: 'acme', side: 'BUY' as const, referencePrice: 1000,
      idempotencyKey: 'order-idem-1', now: () => 1000,
    }
    await createPendingOrder({ ...base, quantity: 5 })
    await expect(createPendingOrder({ ...base, quantity: 9 })).rejects.toThrow('Idempotency key payload mismatch')
  })
})

describe('getOrder', () => {
  it('returns the order document when it exists', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/orders/order-1', { orderId: 'order-1', status: 'PENDING' })
    const result = await getOrder({ firestore: fake as never, lessonRunId: 'run-1', orderId: 'order-1' })
    expect(result).toMatchObject({ orderId: 'order-1', status: 'PENDING' })
  })

  it('returns null when the order does not exist', async () => {
    const fake = makeFakeFirestore()
    const result = await getOrder({ firestore: fake as never, lessonRunId: 'run-1', orderId: 'missing' })
    expect(result).toBeNull()
  })
})

describe('transitionOrderStatus', () => {
  it('moves PENDING to CANCELLED and records no execution price', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/orders/order-1', { status: 'PENDING', orderId: 'order-1' })
    await transitionOrderStatus({
      firestore: fake as never, lessonRunId: 'run-1', orderId: 'order-1',
      from: 'PENDING', to: 'CANCELLED',
    })
    expect(fake.docs.get('lessonRuns/run-1/orders/order-1')).toMatchObject({ status: 'CANCELLED' })
  })

  it('refuses to transition an order that is not in the expected `from` status', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/orders/order-1', { status: 'PROCESSING', orderId: 'order-1' })
    await expect(transitionOrderStatus({
      firestore: fake as never, lessonRunId: 'run-1', orderId: 'order-1',
      from: 'PENDING', to: 'CANCELLED',
    })).rejects.toThrow('注文の状態が想定と異なります')
  })

  it('refuses to transition an order that does not exist', async () => {
    const fake = makeFakeFirestore()
    await expect(transitionOrderStatus({
      firestore: fake as never, lessonRunId: 'run-1', orderId: 'missing',
      from: 'PENDING', to: 'CANCELLED',
    })).rejects.toThrow('注文が見つかりません')
  })

  it('applies an optional patch alongside the status change (e.g. settledAtServerMillis/executionPrice)', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/orders/order-1', { status: 'PROCESSING', orderId: 'order-1' })
    await transitionOrderStatus({
      firestore: fake as never, lessonRunId: 'run-1', orderId: 'order-1',
      from: 'PROCESSING', to: 'FILLED',
      patch: { executionPrice: 1234, settledAtServerMillis: 5000 },
    })
    expect(fake.docs.get('lessonRuns/run-1/orders/order-1')).toMatchObject({
      status: 'FILLED', executionPrice: 1234, settledAtServerMillis: 5000,
    })
  })
})

describe('order history retains both reference price and execution price (spec §12.11/§27.2 item 6)', () => {
  it('keeps referencePrice unchanged and adds executionPrice when transitioning to FILLED', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/orders/order-1', {
      orderId: 'order-1', status: 'PROCESSING', referencePrice: 1000,
    })
    await transitionOrderStatus({
      firestore: fake as never, lessonRunId: 'run-1', orderId: 'order-1',
      from: 'PROCESSING', to: 'FILLED', patch: { executionPrice: 1030 },
    })
    const stored = fake.docs.get('lessonRuns/run-1/orders/order-1')
    expect(stored).toMatchObject({ referencePrice: 1000, executionPrice: 1030, status: 'FILLED' })
  })
})

describe('listPendingOrdersForBatch', () => {
  it('returns only PENDING orders for the given batchId, ignoring other batches and statuses', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/orders/o1', { orderId: 'o1', batchId: 'batch-3', status: 'PENDING' })
    fake.docs.set('lessonRuns/run-1/orders/o2', { orderId: 'o2', batchId: 'batch-3', status: 'CANCELLED' })
    fake.docs.set('lessonRuns/run-1/orders/o3', { orderId: 'o3', batchId: 'batch-2', status: 'PENDING' })
    const result = await listPendingOrdersForBatch({
      firestore: fake as never, lessonRunId: 'run-1', batchId: 'batch-3',
    })
    expect(result.map((o) => o.orderId)).toEqual(['o1'])
  })
})

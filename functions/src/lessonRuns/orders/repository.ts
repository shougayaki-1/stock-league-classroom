import { getFirestore } from 'firebase-admin/firestore'
import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../../lib/idempotency'
import type { MarketOrder, OrderStatus } from '../../market/orderTypes'

export interface FirestoreTx {
  get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  set: (path: string, data: Record<string, unknown>) => void
  update: (path: string, data: Record<string, unknown>) => void
}
export interface FirestoreLike {
  runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => Promise<T>
}
/** Extends `FirestoreLike` with the read-only lookup `getOrder` needs
 * outside of a transaction, and the query `listPendingOrdersForBatch`
 * needs (Admin SDK: `where('batchId','==',...).where('status','==','PENDING')`). */
export interface QueryableFirestoreLike extends FirestoreLike {
  getDoc: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  queryOrders: (lessonRunId: string, batchId: string, status: OrderStatus) => Promise<MarketOrder[]>
}

export interface CreatePendingOrderInput {
  firestore: FirestoreLike
  lessonRunId: string
  batchId: string
  teamId: string
  participantId?: string
  stockId: string
  side: 'BUY' | 'SELL'
  quantity: number
  referencePrice: number
  idempotencyKey: string
  now: () => number
}

/**
 * Idempotent per (lessonRunId, idempotencyKey) — spec §12.13. Reuses
 * `idempotencyDocumentId`/`requestDigest` from `lib/idempotency.ts`, the
 * same pattern `createLessonRun`/`appendLessonEvent` use: a lookup document
 * at a hashed path records which orderId a given key already produced, and
 * a stored request digest catches a key being replayed with materially
 * different order fields (rejected rather than silently deduplicated).
 */
export const createPendingOrder = async (
  input: CreatePendingOrderInput,
): Promise<{ orderId: string; created: boolean }> => input.firestore.runTransaction(async (tx) => {
  const idempotencyId = idempotencyDocumentId(input.lessonRunId, input.idempotencyKey)
  const idempotencyPath = `lessonRuns/${input.lessonRunId}/orderIdempotency/${idempotencyId}`
  const digest = computeRequestDigest({
    batchId: input.batchId, teamId: input.teamId, participantId: input.participantId ?? null,
    stockId: input.stockId, side: input.side, quantity: input.quantity, referencePrice: input.referencePrice,
  })

  // All reads before all writes (Firestore transaction requirement) — the
  // idempotency lookup is the only read this transaction needs.
  const existing = await tx.get(idempotencyPath)
  if (existing.exists) {
    const prior = existing.data() as { orderId: string; requestDigest: string }
    if (prior.requestDigest !== digest) throw new Error('Idempotency key payload mismatch')
    return { orderId: prior.orderId, created: false }
  }

  const orderId = `${input.lessonRunId}_order_${idempotencyId}`
  const order: MarketOrder = {
    orderId,
    idempotencyKey: input.idempotencyKey,
    lessonRunId: input.lessonRunId,
    batchId: input.batchId,
    ...(input.participantId !== undefined ? { participantId: input.participantId } : {}),
    teamId: input.teamId,
    stockId: input.stockId,
    side: input.side,
    quantity: input.quantity,
    referencePrice: input.referencePrice,
    status: 'PENDING',
    submittedAtServerMillis: input.now(),
  }
  tx.set(`lessonRuns/${input.lessonRunId}/orders/${orderId}`, order as unknown as Record<string, unknown>)
  tx.set(idempotencyPath, { orderId, requestDigest: digest })
  return { orderId, created: true }
})

export interface GetOrderInput {
  firestore: QueryableFirestoreLike
  lessonRunId: string
  orderId: string
}

export const getOrder = async (input: GetOrderInput): Promise<MarketOrder | null> => {
  const snap = await input.firestore.getDoc(`lessonRuns/${input.lessonRunId}/orders/${input.orderId}`)
  if (!snap.exists) return null
  return snap.data() as unknown as MarketOrder
}

export interface ListPendingOrdersForBatchInput {
  firestore: QueryableFirestoreLike
  lessonRunId: string
  batchId: string
}

export const listPendingOrdersForBatch = async (
  input: ListPendingOrdersForBatchInput,
): Promise<MarketOrder[]> => input.firestore.queryOrders(input.lessonRunId, input.batchId, 'PENDING')

export interface TransitionOrderStatusInput {
  firestore: FirestoreLike
  lessonRunId: string
  orderId: string
  from: OrderStatus
  to: OrderStatus
  patch?: Partial<MarketOrder>
}

/** Guards every status change with a compare-and-set on `from` so a
 * concurrent settle and a concurrent cancel can never both succeed. */
export const transitionOrderStatus = async (input: TransitionOrderStatusInput): Promise<void> => {
  await input.firestore.runTransaction(async (tx) => {
    const path = `lessonRuns/${input.lessonRunId}/orders/${input.orderId}`
    const snap = await tx.get(path)
    if (!snap.exists) throw new Error('注文が見つかりません')
    const current = snap.data() as { status: OrderStatus }
    if (current.status !== input.from) throw new Error('注文の状態が想定と異なります')
    tx.update(path, { status: input.to, ...(input.patch ?? {}) })
  })
}

/**
 * Server-internal only: no Callable wraps this directly. Task 6+ operation
 * flows call these after they have already authorized the request and
 * completed their own business logic, same shape as
 * `appendLessonEventWithAdminSdk`.
 */
export const ordersRepositoryWithAdminSdk = (): QueryableFirestoreLike => {
  const db = getFirestore()
  return {
    runTransaction: (fn) => db.runTransaction((tx) => fn({
      get: async (path) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
      set: (path, data) => { tx.set(db.doc(path), data) },
      update: (path, data) => { tx.update(db.doc(path), data) },
    })),
    getDoc: async (path) => { const snap = await db.doc(path).get(); return { exists: snap.exists, data: () => snap.data() } },
    queryOrders: async (lessonRunId, batchId, status) => {
      const snap = await db.collection('lessonRuns').doc(lessonRunId).collection('orders')
        .where('batchId', '==', batchId).where('status', '==', status).get()
      return snap.docs.map((d) => d.data() as unknown as MarketOrder)
    },
  }
}

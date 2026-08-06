import { getFirestore } from 'firebase-admin/firestore'
import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../lib/idempotency'

export interface FirestoreTx {
  get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  set: (path: string, data: Record<string, unknown>) => void
}
export interface AppendLessonEventDeps {
  firestore: { runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => Promise<T> }
  lessonRunId: string
  orgId: string
  type: string
  actorType: 'SYSTEM' | 'TEACHER' | 'STUDENT' | 'OPERATOR'
  actorId?: string
  payload: unknown
  idempotencyKey: string
  now?: () => unknown
}
export interface AppendLessonEventResult { eventId: string; sequence: number; deduplicated: boolean }

/**
 * sequence is a per-lessonRunId monotonically increasing counter stored on
 * `lessonRuns/{lessonRunId}/meta/eventCounter`. Both the counter read and the
 * idempotency dedup check happen inside the same transaction as the event
 * write, so a concurrent double-submit either both see the same counter
 * value and one aborts on retry (Firestore transaction contention), or the
 * second sees the first's idempotency doc and short-circuits — never both
 * incrementing from the same base.
 *
 * Extracted so Task 9's restore flow can call this helper inside its own
 * Firestore transaction (alongside a `restoreGeneration` update) and commit
 * both atomically. It returns the typed result directly rather than a JSON
 * string — nothing here inherits a fixed `Promise<string>` transaction
 * contract, so `FirestoreTx.runTransaction` is generic over the return type
 * and there is no serialize/parse round-trip.
 */
export const appendLessonEventInTransaction = async (
  tx: FirestoreTx,
  input: Omit<AppendLessonEventDeps, 'firestore' | 'now'>,
  nowValue: unknown,
): Promise<AppendLessonEventResult> => {
  const idempotencyId = idempotencyDocumentId(input.lessonRunId, input.idempotencyKey)
  const idempotencyPath = `lessonRuns/${input.lessonRunId}/eventIdempotency/${idempotencyId}`
  const counterPath = `lessonRuns/${input.lessonRunId}/meta/eventCounter`
  const requestDigest = computeRequestDigest({
    orgId: input.orgId, type: input.type, actorType: input.actorType,
    actorId: input.actorId ?? null, payload: input.payload,
  })

  const existing = await tx.get(idempotencyPath)
  if (existing.exists) {
    const prior = existing.data() as { eventId: string; sequence: number; requestDigest: string }
    if (prior.requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
    return { eventId: prior.eventId, sequence: prior.sequence, deduplicated: true }
  }
  const counterSnap = await tx.get(counterPath)
  const nextSequence = counterSnap.exists ? (counterSnap.data() as { value: number }).value + 1 : 0
  const eventId = `${input.lessonRunId}_${nextSequence}`
  tx.set(`lessonRuns/${input.lessonRunId}/events/${eventId}`, {
    eventId, lessonRunId: input.lessonRunId, orgId: input.orgId, type: input.type,
    actorType: input.actorType, actorId: input.actorId ?? null, idempotencyKey: input.idempotencyKey,
    payload: input.payload, serverOccurredAt: nowValue, sequence: nextSequence,
  })
  tx.set(counterPath, { value: nextSequence })
  tx.set(idempotencyPath, { eventId, sequence: nextSequence, requestDigest })
  return { eventId, sequence: nextSequence, deduplicated: false }
}

export const appendLessonEvent = async (deps: AppendLessonEventDeps): Promise<AppendLessonEventResult> => {
  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  const { lessonRunId, orgId, type, actorType, actorId, payload, idempotencyKey } = deps
  return deps.firestore.runTransaction((tx) =>
    appendLessonEventInTransaction(tx, { lessonRunId, orgId, type, actorType, actorId, payload, idempotencyKey }, nowValue),
  )
}

/**
 * Server-internal only: no Callable wraps this. Exposing arbitrary
 * `type`/`actorType`/`payload` to any client would let a teacher forge
 * `SYSTEM` events or future trade-execution events, destroying audit-log
 * integrity. Phase B/C operation Callables call this after they have
 * already authorized the request and completed their own business logic.
 */
export const appendLessonEventWithAdminSdk = (input: Omit<AppendLessonEventDeps, 'firestore' | 'now'>): Promise<AppendLessonEventResult> => {
  const db = getFirestore()
  return appendLessonEvent({
    firestore: {
      runTransaction: (fn) => db.runTransaction((tx) => fn({
        get: async (path) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
        set: (path, data) => { tx.set(db.doc(path), data) },
      })),
    },
    ...input,
  })
}

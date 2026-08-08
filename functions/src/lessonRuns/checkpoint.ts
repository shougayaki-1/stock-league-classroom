import { getFirestore } from 'firebase-admin/firestore'
import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../lib/idempotency'
import { appendLessonEventInTransaction } from './appendLessonEvent'

interface Tx {
  get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  set: (path: string, data: Record<string, unknown>) => void
  update: (path: string, data: Record<string, unknown>) => void
}
export interface WriteCheckpointDeps {
  firestore: { runTransaction: (fn: (tx: Tx) => Promise<string>) => Promise<string> }
  lessonRunId: string; phaseId: string; sequence: number; snapshot: unknown; createdBy: 'SYSTEM' | 'TEACHER'; idempotencyKey: string
}
export interface WriteCheckpointResult { checkpointId: string; deduplicated: boolean }

export const writeCheckpoint = async (deps: WriteCheckpointDeps): Promise<WriteCheckpointResult> => {
  const raw = await deps.firestore.runTransaction(async (tx) => {
    const runSnap = await tx.get(`lessonRuns/${deps.lessonRunId}`)
    if (!runSnap.exists) throw new Error('LessonRun not found')
    const restoreGeneration = (runSnap.data() as { restoreGeneration: number }).restoreGeneration ?? 0
    const keyHash = idempotencyDocumentId(deps.lessonRunId, deps.idempotencyKey)
    const checkpointId = `cp_${restoreGeneration}_${deps.sequence}_${keyHash.slice(0, 16)}`
    const checkpointPath = `lessonRuns/${deps.lessonRunId}/checkpoints/${checkpointId}`
    const requestDigest = computeRequestDigest({
      phaseId: deps.phaseId, sequence: deps.sequence, snapshot: deps.snapshot,
      createdBy: deps.createdBy, restoreGeneration,
    })
    const existing = await tx.get(checkpointPath)
    if (existing.exists) {
      if ((existing.data() as { requestDigest: string }).requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
      return JSON.stringify({ checkpointId, deduplicated: true })
    }
    tx.set(checkpointPath, {
      id: checkpointId, lessonRunId: deps.lessonRunId, sequence: deps.sequence, phaseId: deps.phaseId,
      snapshot: deps.snapshot, createdBy: deps.createdBy, restoreGeneration, requestDigest,
    })
    return JSON.stringify({ checkpointId, deduplicated: false })
  })
  return JSON.parse(raw) as WriteCheckpointResult
}

export interface RestoreCheckpointDeps {
  firestore: { runTransaction: (fn: (tx: Tx) => Promise<string>) => Promise<string> }
  lessonRunId: string; checkpointId: string; reason: string; actorId: string; idempotencyKey: string
}
export interface RestoreCheckpointResult { newRestoreGeneration: number; eventId: string; deduplicated: boolean }

/**
 * "Restore" is append, not rewind (resolutions.md section E): nothing is
 * deleted. LessonRun.restoreGeneration is incremented, and the restore
 * itself is recorded as a CHECKPOINT_RESTORED LessonEvent. Downstream
 * replay logic (Phase C+) is responsible for treating events after the
 * checkpoint's sequence, tagged with the OLD restoreGeneration, as
 * superseded rather than deleting them.
 */
export const restoreCheckpoint = async (deps: RestoreCheckpointDeps): Promise<RestoreCheckpointResult> => {
  const restoreKey = idempotencyDocumentId(deps.lessonRunId, deps.idempotencyKey)
  const idempotencyPath = `lessonRuns/${deps.lessonRunId}/checkpointRestoreIdempotency/${restoreKey}`
  const requestDigest = computeRequestDigest({
    checkpointId: deps.checkpointId, reason: deps.reason, actorId: deps.actorId,
  })
  const raw = await deps.firestore.runTransaction(async (tx) => {
    const existing = await tx.get(idempotencyPath)
    if (existing.exists) {
      const prior = existing.data() as { newRestoreGeneration: number; eventId: string; requestDigest: string }
      if (prior.requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
      return JSON.stringify({ newRestoreGeneration: prior.newRestoreGeneration, eventId: prior.eventId, deduplicated: true })
    }
    const runSnap = await tx.get(`lessonRuns/${deps.lessonRunId}`)
    if (!runSnap.exists) throw new Error('LessonRun not found')
    const run = runSnap.data() as { restoreGeneration: number; orgId: string }
    const checkpointSnap = await tx.get(`lessonRuns/${deps.lessonRunId}/checkpoints/${deps.checkpointId}`)
    if (!checkpointSnap.exists) throw new Error('Checkpoint not found')
    const newRestoreGeneration = run.restoreGeneration + 1
    const event = await appendLessonEventInTransaction(tx, {
      lessonRunId: deps.lessonRunId, orgId: run.orgId, type: 'CHECKPOINT_RESTORED',
      actorType: 'TEACHER', actorId: deps.actorId,
      payload: { checkpointId: deps.checkpointId, reason: deps.reason, newRestoreGeneration },
      idempotencyKey: deps.idempotencyKey,
    }, new Date().toISOString())
    tx.update(`lessonRuns/${deps.lessonRunId}`, { restoreGeneration: newRestoreGeneration })
    tx.set(idempotencyPath, { newRestoreGeneration, eventId: event.eventId, checkpointId: deps.checkpointId, requestDigest })
    return JSON.stringify({ newRestoreGeneration, eventId: event.eventId, deduplicated: false })
  })
  return JSON.parse(raw) as RestoreCheckpointResult
}

/**
 * Production wiring: Firestore Admin SDK transaction adapter. `writeCheckpoint`
 * has no Callable of its own — Phase B/C server-side flows (system-triggered
 * checkpoints, teacher-triggered checkpoints from an already-authorized
 * Callable) call this directly, the same reasoning Task 8 applied to
 * `appendLessonEventWithAdminSdk`: exposing checkpoint creation directly to a
 * client would let a teacher forge arbitrary snapshot state.
 */
export const writeCheckpointWithAdminSdk = (
  input: Omit<WriteCheckpointDeps, 'firestore'>,
): Promise<WriteCheckpointResult> => {
  const db = getFirestore()
  return writeCheckpoint({
    firestore: {
      runTransaction: (fn) => db.runTransaction((tx) => fn({
        get: async (path) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
        set: (path, data) => { tx.set(db.doc(path), data) },
        update: (path, data) => { tx.update(db.doc(path), data) },
      })),
    },
    ...input,
  })
}

/**
 * Production wiring for `restoreCheckpoint`. Unlike `writeCheckpoint`, this
 * one *is* reachable from a client, but only through `restoreCheckpointCallable`
 * (see onCall.ts), which authorizes the caller (teacher role PRIMARY/ASSISTANT
 * on the target run + active org membership) before ever calling this.
 */
export const restoreCheckpointWithAdminSdk = (
  input: Omit<RestoreCheckpointDeps, 'firestore'>,
): Promise<RestoreCheckpointResult> => {
  const db = getFirestore()
  return restoreCheckpoint({
    firestore: {
      runTransaction: (fn) => db.runTransaction((tx) => fn({
        get: async (path) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
        set: (path, data) => { tx.set(db.doc(path), data) },
        update: (path, data) => { tx.update(db.doc(path), data) },
      })),
    },
    ...input,
  })
}

import { getFirestore } from 'firebase-admin/firestore'
import { processBatchWithAdminSdk } from './processBatch'

export interface PauseMarketDeps {
  readCurrentBatch: (lessonRunId: string) => Promise<{ batchId: string; batchIndex: number }>
  processBatch: (input: { lessonRunId: string; batchId: string; batchIndex: number }) => Promise<void>
  setMarketPaused: (input: { lessonRunId: string; paused: boolean }) => Promise<void>
  lessonRunId: string
}

/**
 * Order matters: drain THEN pause. If these were reversed, submitOrder's
 * isMarketAcceptingOrders check (Task 7) would still see marketPaused=false
 * for a brief window, letting a new order slip into a batch nobody will
 * ever process (no task is scheduled after this call).
 */
export const pauseMarket = async (deps: PauseMarketDeps): Promise<void> => {
  const current = await deps.readCurrentBatch(deps.lessonRunId)
  await deps.processBatch({ lessonRunId: deps.lessonRunId, batchId: current.batchId, batchIndex: current.batchIndex })
  await deps.setMarketPaused({ lessonRunId: deps.lessonRunId, paused: true })
}

// ---------------------------------------------------------------------
// Admin SDK wiring
// ---------------------------------------------------------------------

/**
 * The "currently in-flight batch" to drain is the one Task 10's
 * `enqueueNextBatch` most recently scheduled — `lessonRuns/{id}.nextBatchId`
 * (written by `taskHandler.ts`'s `enqueueNextBatchWithAdminSdk` alongside
 * `nextBatchAtMillis`). No prior task persists a separate
 * `nextBatchIndex` field (only the composite `nextBatchId` string), so
 * `batchIndex` is parsed back out of `computeNextBatchId`'s own format
 * (`${lessonRunId}_batch_${batchIndex}`) rather than duplicating storage
 * for a value already encoded in `nextBatchId`.
 */
const readCurrentBatchWithAdminSdk: PauseMarketDeps['readCurrentBatch'] = async (lessonRunId) => {
  const snap = await getFirestore().doc(`lessonRuns/${lessonRunId}`).get()
  const data = (snap.data() ?? {}) as { nextBatchId?: string }
  const batchId = data.nextBatchId ?? `${lessonRunId}_batch_0`
  const match = /_batch_(\d+)$/.exec(batchId)
  const batchIndex = match ? Number(match[1]) : 0
  return { batchId, batchIndex }
}

const setMarketPausedWithAdminSdk: PauseMarketDeps['setMarketPaused'] = async ({ lessonRunId, paused }) => {
  await getFirestore().doc(`lessonRuns/${lessonRunId}`).update({ marketPaused: paused })
}

export const pauseMarketWithAdminSdk = (lessonRunId: string): Promise<void> =>
  pauseMarket({
    readCurrentBatch: readCurrentBatchWithAdminSdk,
    processBatch: processBatchWithAdminSdk,
    setMarketPaused: setMarketPausedWithAdminSdk,
    lessonRunId,
  })

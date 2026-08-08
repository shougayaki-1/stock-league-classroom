import { getFirestore } from 'firebase-admin/firestore'
import { processBatchWithAdminSdk } from './processBatch'

export interface PauseMarketDeps {
  readCurrentBatch: (lessonRunId: string) => Promise<{ batchId: string; batchIndex: number }>
  processBatch: (input: { lessonRunId: string; batchId: string; batchIndex: number }) => Promise<void>
  setMarketPaused: (input: { lessonRunId: string; paused: boolean }) => Promise<void>
  lessonRunId: string
}

/**
 * Order matters: PAUSE THEN drain. `processBatch` runs a Firestore
 * transaction and can take a nontrivial amount of time; `marketPaused`
 * must already be true before it starts, not after. If pause happened
 * AFTER drain (the original, incorrect order here), submitOrder's
 * isMarketAcceptingOrders check (Task 7) would keep accepting new orders
 * for the *current* batchId throughout the entire drain call — orders
 * that land after `readCurrentBatch` captured this batchId but before
 * `setMarketPaused` flips the flag. Those orders get created against a
 * batchId that `commitSettlement` has already marked as
 * `lastProcessedBatchId` (or is in the middle of processing) and for
 * which no further batch task is ever scheduled (pausing stops the
 * chain) — they are stuck PENDING forever, with their cash/shares
 * soft-locked forever along with them.
 *
 * Pausing first closes that window: the instant `setMarketPaused` commits,
 * submitOrder starts rejecting new orders for this lessonRun. `processBatch`
 * then safely drains whatever was already PENDING for the current batch at
 * that moment — orders accepted before the pause still fill normally, which
 * is the original requirement this ordering must (and does) preserve.
 */
export const pauseMarket = async (deps: PauseMarketDeps): Promise<void> => {
  const current = await deps.readCurrentBatch(deps.lessonRunId)
  await deps.setMarketPaused({ lessonRunId: deps.lessonRunId, paused: true })
  await deps.processBatch({ lessonRunId: deps.lessonRunId, batchId: current.batchId, batchIndex: current.batchIndex })
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

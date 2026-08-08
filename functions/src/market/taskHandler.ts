import { getFirestore } from 'firebase-admin/firestore'
import { getFunctions } from 'firebase-admin/functions'
import { onTaskDispatched } from 'firebase-functions/v2/tasks'
import { enqueueNextBatch, shouldProcessBatch } from './batchScheduler'
import { processBatchWithAdminSdk } from './processBatch'

export interface BatchTaskHandlerDeps {
  readRunState: (lessonRunId: string) => Promise<{ status: string; marketPaused: boolean; lastProcessedBatchId: string | null }>
  processBatch: (input: { lessonRunId: string; batchId: string; batchIndex: number }) => Promise<void>
  enqueueNextBatch: (input: { lessonRunId: string; nextBatchIndex: number }) => Promise<void>
  lessonRunId: string
  batchId: string
  batchIndex: number
}

/**
 * The self-chain lives entirely in this one function: process, THEN
 * immediately enqueue the next task, unconditionally (spec resolution
 * A's flow diagram). If this function throws after processBatch succeeds
 * but before enqueueNextBatch runs, Cloud Tasks' own retry (this handler
 * is itself invoked via a task) re-enters here — shouldProcessBatch's
 * batchId dedup means the retry will skip processBatch (already done)
 * and go straight to enqueueNextBatch, so the chain still continues.
 *
 * NOTE (idempotency gap): the above relies on `processBatch` itself
 * guarding its "same batchId processed only once" invariant inside a
 * Firestore transaction (Task 9 Step 7 / 矛盾解消A必須事項2) — this
 * handler only decides whether to *attempt* processing, not whether the
 * attempt is safe to repeat.
 */
export const batchTaskHandler = async (deps: BatchTaskHandlerDeps): Promise<void> => {
  const runState = await deps.readRunState(deps.lessonRunId)
  if (!shouldProcessBatch({
    status: runState.status, marketPaused: runState.marketPaused,
    batchId: deps.batchId, lastProcessedBatchId: runState.lastProcessedBatchId,
  })) {
    return
  }
  await deps.processBatch({ lessonRunId: deps.lessonRunId, batchId: deps.batchId, batchIndex: deps.batchIndex })
  await deps.enqueueNextBatch({ lessonRunId: deps.lessonRunId, nextBatchIndex: deps.batchIndex + 1 })
}

// ---------------------------------------------------------------------
// Admin SDK wiring
// ---------------------------------------------------------------------

/** Name of the deployed `onTaskDispatched` function this queue targets —
 * must match the exported const name below (`batchTaskQueue`) and
 * `functions/src/index.ts`'s export, since `getFunctions().taskQueue()`
 * resolves the queue by function name. */
const BATCH_TASK_QUEUE_FUNCTION_NAME = 'batchTaskQueue'

/** spec §12.9's 3-second default (1-10s authored range, validated by
 * `templateValidation.ts`'s `batchIntervalSeconds` check). No prior task
 * wired a per-lessonRun authored value onto the `lessonRuns/{id}` doc
 * itself (same provisional-field gap as `processBatch.ts`'s
 * `priceSensitivityPreset` default) — this reads an optional flat
 * `batchIntervalSeconds` field with this constant as fallback. */
const DEFAULT_BATCH_INTERVAL_SECONDS = 3

const readRunStateWithAdminSdk: BatchTaskHandlerDeps['readRunState'] = async (lessonRunId) => {
  const snap = await getFirestore().doc(`lessonRuns/${lessonRunId}`).get()
  const data = (snap.data() ?? {}) as { status?: string; marketPaused?: boolean; lastProcessedBatchId?: string }
  return {
    status: data.status ?? 'UNKNOWN',
    marketPaused: data.marketPaused ?? false,
    lastProcessedBatchId: data.lastProcessedBatchId ?? null,
  }
}

/**
 * Admin SDK implementation of Task 10's `enqueueNextBatch` (batchScheduler.ts):
 * `writeNextBatchAt` updates the DB-authoritative `nextBatchAtMillis` (矛盾
 * 解消A必須事項1), `scheduleTask` enqueues the following Cloud Task via
 * `getFunctions().taskQueue(...).enqueue()` — signature confirmed against
 * firebase-admin v13.10.0's bundled `functions-api.d.ts` and the
 * firebase-functions v7 docs via context7 on 2026-08-08 (see
 * task-10-report.md). The task's own `batchId` is passed as the Cloud
 * Tasks `id` option, which Cloud Tasks itself rejects as a duplicate if
 * the same task ID is enqueued again within ~1 hour — an extra layer of
 * at-least-once-delivery protection on top of `shouldProcessBatch`'s
 * Firestore-level dedup.
 */
/** Exported for Task 11's market-start/resume flow to enqueue the FIRST
 * batch task when a lessonRun transitions into RUNNING — this task only
 * builds the self-chain itself, not the flow that kicks it off. */
export const enqueueNextBatchWithAdminSdk = async (input: { lessonRunId: string; nextBatchIndex: number }): Promise<void> => {
  await enqueueNextBatch({
    lessonRunId: input.lessonRunId,
    nextBatchIndex: input.nextBatchIndex,
    intervalSeconds: DEFAULT_BATCH_INTERVAL_SECONDS,
    now: Date.now,
    writeNextBatchAt: async ({ lessonRunId, nextBatchAtMillis, nextBatchId }) => {
      await getFirestore().doc(`lessonRuns/${lessonRunId}`).update({ nextBatchAtMillis, nextBatchId })
    },
    scheduleTask: async ({ batchId, lessonRunId, scheduleTimeMillis }) => {
      const queue = getFunctions().taskQueue<{ lessonRunId: string; batchId: string; batchIndex: number }>(BATCH_TASK_QUEUE_FUNCTION_NAME)
      await queue.enqueue(
        { lessonRunId, batchId, batchIndex: input.nextBatchIndex },
        { id: batchId, scheduleTime: new Date(scheduleTimeMillis) },
      )
    },
  })
}

/**
 * Cloud Tasks-invoked entry point (矛盾解消A). Deployed as
 * `functions/src/index.ts`'s `batchTaskQueue` export — the name Cloud
 * Tasks dispatches to must match `BATCH_TASK_QUEUE_FUNCTION_NAME` above.
 * `retryConfig`/`rateLimits` follow firebase-functions v7's
 * `TaskQueueOptions` (context7-confirmed 2026-08-08): a handler failure
 * (thrown error) triggers Cloud Tasks' own retry, which is the intended
 * safety net for the "processBatch succeeded, enqueueNextBatch didn't run
 * yet" gap `batchTaskHandler`'s doc comment describes.
 */
export const batchTaskQueue = onTaskDispatched<{ lessonRunId: string; batchId: string; batchIndex: number }>(
  {
    region: 'asia-northeast1',
    retryConfig: { maxAttempts: 5, minBackoffSeconds: 1, maxBackoffSeconds: 30 },
    rateLimits: { maxConcurrentDispatches: 50 },
  },
  async (request) => {
    const { lessonRunId, batchId, batchIndex } = request.data
    await batchTaskHandler({
      readRunState: readRunStateWithAdminSdk,
      processBatch: processBatchWithAdminSdk,
      enqueueNextBatch: enqueueNextBatchWithAdminSdk,
      lessonRunId, batchId, batchIndex,
    })
  },
)

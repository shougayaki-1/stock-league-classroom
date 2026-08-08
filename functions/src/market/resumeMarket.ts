import { getFirestore } from 'firebase-admin/firestore'
import { getFunctions } from 'firebase-admin/functions'
import { onTaskDispatched } from 'firebase-functions/v2/tasks'
import { enqueueNextBatchWithAdminSdk } from './taskHandler'

export interface ExecuteScheduledResumeDeps {
  flipToRunning: (input: { lessonRunId: string }) => Promise<void>
  enqueueNextBatch: (input: { lessonRunId: string; nextBatchIndex: number }) => Promise<void>
  readLastProcessedBatchIndex: (lessonRunId: string) => Promise<number>
  lessonRunId: string
}

/** The body of the one-shot Cloud Task scheduled by resumeMarket (or
 * called directly for the confirmationSeconds === 0 path — spec §12.26
 * "確認なしの即時再開" still restarts the self-chain, it just skips the
 * scheduling round-trip). Unpausing THEN restarting the chain (not the
 * reverse) mirrors pauseMarket's own "drain then flip" ordering: flipping
 * marketPaused=false first ensures submitOrder's isMarketAcceptingOrders
 * check (Task 7) already reflects the resumed state by the time the next
 * batch's orders could be accepted. */
export const executeScheduledResume = async (deps: ExecuteScheduledResumeDeps): Promise<void> => {
  await deps.flipToRunning({ lessonRunId: deps.lessonRunId })
  const lastIndex = await deps.readLastProcessedBatchIndex(deps.lessonRunId)
  await deps.enqueueNextBatch({ lessonRunId: deps.lessonRunId, nextBatchIndex: lastIndex + 1 })
}

export interface ResumeMarketDeps {
  recordResumeSchedule: (input: { lessonRunId: string; resumeScheduledAtMillis: number }) => Promise<void>
  scheduleResumeTask: (input: { lessonRunId: string; scheduleTimeMillis: number }) => Promise<void>
  flipToRunning: (input: { lessonRunId: string }) => Promise<void>
  enqueueNextBatch: (input: { lessonRunId: string; nextBatchIndex: number }) => Promise<void>
  readLastProcessedBatchIndex: (lessonRunId: string) => Promise<number>
  lessonRunId: string
  /** Default 30 per spec §12.26/§28. 0 means immediate resume, no confirmation window. */
  confirmationSeconds: number
  now: () => number
}

/**
 * spec §12.26: teacher-initiated resume, with a default 30-second
 * confirmation window before the market actually goes live again (gives
 * students a heads-up). `confirmationSeconds === 0` is the "確認なしの
 * 即時再開" escape hatch — it still MUST restart Task 10's self-chain
 * (`executeScheduledResume`), not just flip the status flag: without
 * this, a market flipped straight to RUNNING would sit unpaused with no
 * task ever processing a batch again (see task-12-brief.md Step 5's own
 * correction of an earlier, incomplete draft of this function).
 */
export const resumeMarket = async (deps: ResumeMarketDeps): Promise<void> => {
  if (deps.confirmationSeconds === 0) {
    await executeScheduledResume(deps)
    return
  }
  const resumeScheduledAtMillis = deps.now() + deps.confirmationSeconds * 1000
  await deps.recordResumeSchedule({ lessonRunId: deps.lessonRunId, resumeScheduledAtMillis })
  await deps.scheduleResumeTask({ lessonRunId: deps.lessonRunId, scheduleTimeMillis: resumeScheduledAtMillis })
}

// ---------------------------------------------------------------------
// Admin SDK wiring
// ---------------------------------------------------------------------

/** Name of the deployed `onTaskDispatched` function this queue targets —
 * must match this file's exported const (`resumeTaskQueue`) and
 * `functions/src/index.ts`'s export, mirroring taskHandler.ts's
 * `BATCH_TASK_QUEUE_FUNCTION_NAME` convention for the batch chain. */
const RESUME_TASK_QUEUE_FUNCTION_NAME = 'resumeTaskQueue'

/** Default confirmation window per spec §12.26/§28. */
export const DEFAULT_RESUME_CONFIRMATION_SECONDS = 30

/**
 * Same batchIndex-recovery trick as `pauseMarket.ts`'s
 * `readCurrentBatchWithAdminSdk`: no prior task persists a dedicated
 * `lastProcessedBatchIndex` field, only `processBatch`'s
 * `lessonRuns/{id}.lastProcessedBatchId` string
 * (`${lessonRunId}_batch_${batchIndex}`, written by Task 10's
 * `processBatchWithAdminSdk`). The index is parsed back out of that
 * format rather than duplicating storage for a value already encoded in
 * it. Falls back to -1 (so the very next enqueue starts at index 0) if
 * the run has never processed a batch yet — matches
 * `readCurrentBatchWithAdminSdk`'s "batch 0" fallback semantics.
 */
const readLastProcessedBatchIndexWithAdminSdk: ResumeMarketDeps['readLastProcessedBatchIndex'] = async (lessonRunId) => {
  const snap = await getFirestore().doc(`lessonRuns/${lessonRunId}`).get()
  const data = (snap.data() ?? {}) as { lastProcessedBatchId?: string }
  const match = data.lastProcessedBatchId ? /_batch_(\d+)$/.exec(data.lastProcessedBatchId) : null
  return match ? Number(match[1]) : -1
}

const flipToRunningWithAdminSdk: ResumeMarketDeps['flipToRunning'] = async ({ lessonRunId }) => {
  await getFirestore().doc(`lessonRuns/${lessonRunId}`).update({ marketPaused: false })
}

const recordResumeScheduleWithAdminSdk: ResumeMarketDeps['recordResumeSchedule'] = async ({ lessonRunId, resumeScheduledAtMillis }) => {
  await getFirestore().doc(`lessonRuns/${lessonRunId}`).update({ resumeScheduledAtMillis })
}

/** Enqueues the one-shot Cloud Task that will invoke `executeScheduledResume`
 * once the confirmation window elapses — same `getFunctions().taskQueue()`
 * shape as `taskHandler.ts`'s `enqueueNextBatchWithAdminSdk`, just against
 * a different queue and a single dispatch instead of a chain. */
const scheduleResumeTaskWithAdminSdk: ResumeMarketDeps['scheduleResumeTask'] = async ({ lessonRunId, scheduleTimeMillis }) => {
  const queue = getFunctions().taskQueue<{ lessonRunId: string }>(RESUME_TASK_QUEUE_FUNCTION_NAME)
  await queue.enqueue({ lessonRunId }, { scheduleTime: new Date(scheduleTimeMillis) })
}

export const resumeMarketWithAdminSdk = async (
  lessonRunId: string,
  confirmationSeconds: number = DEFAULT_RESUME_CONFIRMATION_SECONDS,
): Promise<void> => {
  await resumeMarket({
    recordResumeSchedule: recordResumeScheduleWithAdminSdk,
    scheduleResumeTask: scheduleResumeTaskWithAdminSdk,
    flipToRunning: flipToRunningWithAdminSdk,
    enqueueNextBatch: enqueueNextBatchWithAdminSdk,
    readLastProcessedBatchIndex: readLastProcessedBatchIndexWithAdminSdk,
    lessonRunId,
    confirmationSeconds,
    now: Date.now,
  })
}

/**
 * Cloud Tasks-invoked entry point for the confirmation-window path.
 * Deployed as `functions/src/index.ts`'s `resumeTaskQueue` export — the
 * name Cloud Tasks dispatches to must match
 * `RESUME_TASK_QUEUE_FUNCTION_NAME` above.
 */
export const executeScheduledResumeWithAdminSdk = async (lessonRunId: string): Promise<void> => {
  await executeScheduledResume({
    flipToRunning: flipToRunningWithAdminSdk,
    enqueueNextBatch: enqueueNextBatchWithAdminSdk,
    readLastProcessedBatchIndex: readLastProcessedBatchIndexWithAdminSdk,
    lessonRunId,
  })
}

/**
 * Cloud Tasks queue function itself — same shape as `taskHandler.ts`'s
 * `batchTaskQueue`, dispatched once at `scheduleResumeTaskWithAdminSdk`'s
 * `scheduleTime` and never retried into a chain (unlike the batch queue,
 * this handler's own body enqueues the batch chain's continuation, but
 * this queue itself only ever fires once per resume).
 */
export const resumeTaskQueue = onTaskDispatched<{ lessonRunId: string }>(
  {
    region: 'asia-northeast1',
    retryConfig: { maxAttempts: 5, minBackoffSeconds: 1, maxBackoffSeconds: 30 },
    rateLimits: { maxConcurrentDispatches: 10 },
  },
  async (request) => {
    await executeScheduledResumeWithAdminSdk(request.data.lessonRunId)
  },
)

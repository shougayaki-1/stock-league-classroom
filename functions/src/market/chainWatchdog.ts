import { getFirestore } from 'firebase-admin/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { logger } from 'firebase-functions/v2'
import { appendLessonEventWithAdminSdk } from '../lessonRuns/appendLessonEvent'

/**
 * 矛盾解消A必須事項3: how long a `RUNNING`, unpaused lessonRun's
 * `nextBatchAtMillis` may be overdue before the chain is considered
 * broken (a Cloud Tasks task was lost and nothing will resume the market
 * on its own). This is a PROVISIONAL operational value — the resolution
 * doc explicitly leaves the detection interval unconfirmed and expects
 * tuning after pilot runs. Kept as the single place this number is
 * defined so a future tuning pass touches one line.
 */
export const STALL_DETECTION_THRESHOLD_MILLIS = 60_000

export interface WatchedLessonRun {
  lessonRunId: string
  orgId: string
  status: string
  marketPaused: boolean
  nextBatchAtMillis: number
}

/**
 * Pure detector: a lessonRun is stalled when it is still `RUNNING`
 * (never paused/completed/aborted — matches `shouldProcessBatch`'s own
 * status gate) and its `nextBatchAtMillis` deadline is more than
 * `thresholdMillis` in the past. A `marketPaused` run is excluded even if
 * its `status` were somehow still `RUNNING`, because pausing is the
 * intentional way to stop the chain (矛盾解消A必須事項4) — that is not a
 * failure to detect.
 */
export const detectStalledRuns = (
  runs: WatchedLessonRun[],
  nowMillis: number,
  thresholdMillis: number,
): WatchedLessonRun[] =>
  runs.filter((run) =>
    run.status === 'RUNNING'
    && !run.marketPaused
    && nowMillis - run.nextBatchAtMillis > thresholdMillis)

export interface ChainWatchdogDeps {
  listRunningLessonRuns: () => Promise<WatchedLessonRun[]>
  notifyStalled: (run: WatchedLessonRun) => Promise<void>
  now?: () => number
  thresholdMillis?: number
}

/**
 * The monitoring half of 矛盾解消A必須事項3's split responsibility: this
 * job only watches and notifies. It never itself enqueues a replacement
 * batch task — that would blur "who is responsible for the chain
 * continuing" and risks a second concurrent chain if the original task
 * was merely slow rather than lost. A teacher (or future auto-recovery
 * Callable) resumes explicitly via Phase B's pause/resume flow.
 */
export const runChainWatchdog = async (deps: ChainWatchdogDeps): Promise<WatchedLessonRun[]> => {
  const nowMillis = (deps.now ?? Date.now)()
  const thresholdMillis = deps.thresholdMillis ?? STALL_DETECTION_THRESHOLD_MILLIS
  const runs = await deps.listRunningLessonRuns()
  const stalled = detectStalledRuns(runs, nowMillis, thresholdMillis)
  for (const run of stalled) {
    await deps.notifyStalled(run)
  }
  return stalled
}

const listRunningLessonRunsWithAdminSdk = async (): Promise<WatchedLessonRun[]> => {
  const db = getFirestore()
  const snap = await db.collection('lessonRuns')
    .where('status', '==', 'RUNNING')
    .where('marketPaused', '==', false)
    .get()
  return snap.docs.map((doc) => {
    const data = doc.data() as { orgId: string; status: string; marketPaused?: boolean; nextBatchAtMillis?: number }
    return {
      lessonRunId: doc.id,
      orgId: data.orgId,
      status: data.status,
      marketPaused: data.marketPaused ?? false,
      nextBatchAtMillis: data.nextBatchAtMillis ?? 0,
    }
  })
}

/**
 * Records `BATCH_CHAIN_STALLED` as a `LessonEvent` (Phase A's audit log,
 * via the same `appendLessonEventWithAdminSdk` every other market/lifecycle
 * operation uses) so it is visible in the lessonRun's event history.
 * Surfacing this as an in-app teacher alert is Phase B's notification UI
 * (`src/lessonRuns/notifications.ts`) — this function only produces the
 * event; wiring a push/toast to it is out of this task's scope.
 */
const notifyStalledWithAdminSdk = async (run: WatchedLessonRun): Promise<void> => {
  await appendLessonEventWithAdminSdk({
    lessonRunId: run.lessonRunId,
    orgId: run.orgId,
    type: 'BATCH_CHAIN_STALLED',
    actorType: 'SYSTEM',
    payload: { nextBatchAtMillis: run.nextBatchAtMillis, thresholdMillis: STALL_DETECTION_THRESHOLD_MILLIS },
    idempotencyKey: `batch-chain-stalled_${run.lessonRunId}_${run.nextBatchAtMillis}`,
  })
  logger.warn('Batch chain stalled', { lessonRunId: run.lessonRunId, nextBatchAtMillis: run.nextBatchAtMillis })
}

/**
 * Cloud Scheduler-backed watchdog (矛盾解消A必須事項3). `onSchedule`'s
 * unix-cron-style interval string confirmed against firebase-functions v7
 * docs via context7 on 2026-08-08 — see task-10-report.md. A 1-minute
 * interval is Cloud Scheduler's minimum granularity and is sufficient for
 * this monitoring purpose (it does not drive the 3-second batch cadence
 * itself — that is Cloud Tasks' self-chain in batchScheduler.ts/
 * taskHandler.ts).
 */
export const chainWatchdogScheduled = onSchedule('every 1 minutes', async () => {
  await runChainWatchdog({
    listRunningLessonRuns: listRunningLessonRunsWithAdminSdk,
    notifyStalled: notifyStalledWithAdminSdk,
  })
})

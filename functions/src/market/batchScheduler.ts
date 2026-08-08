export const computeNextBatchId = (lessonRunId: string, batchIndex: number): string =>
  `${lessonRunId}_batch_${batchIndex}`

export interface ShouldProcessBatchInput {
  status: string
  marketPaused: boolean
  batchId: string
  /** The batchId most recently fully processed for this lessonRun — read
   * from `lessonRuns/{id}` alongside status/marketPaused, in the SAME
   * read as the idempotency check, so a duplicate Cloud Tasks delivery
   * short-circuits here before touching orders at all. */
  lastProcessedBatchId: string | null
}

/** 矛盾解消A必須事項2・4: refuses to reprocess an already-settled batchId,
 * and refuses to do anything once the run is no longer RUNNING or the
 * market has been paused — the only two conditions under which a stale
 * Cloud Tasks delivery should silently no-op instead of erroring (an
 * error would trigger a Cloud Tasks retry, which is wasted work once the
 * lessonRun has moved on). */
export const shouldProcessBatch = (input: ShouldProcessBatchInput): boolean => {
  if (input.status !== 'RUNNING') return false
  if (input.marketPaused) return false
  if (input.batchId === input.lastProcessedBatchId) return false
  return true
}

export interface EnqueueNextBatchDeps {
  writeNextBatchAt: (input: { lessonRunId: string; nextBatchAtMillis: number; nextBatchId: string }) => Promise<void>
  /** Wraps the Cloud Tasks enqueue call. The real implementation
   * (`enqueueNextBatchWithAdminSdk` below) uses
   * `getFunctions().taskQueue('batchTaskHandler').enqueue(...)` from
   * `firebase-admin/functions` (confirmed against firebase-admin v13.10.0's
   * bundled type declarations and the firebase-functions v7 docs via
   * context7 on 2026-08-08 — see task-10-report.md). */
  scheduleTask: (input: { batchId: string; lessonRunId: string; scheduleTimeMillis: number }) => Promise<void>
  lessonRunId: string
  nextBatchIndex: number
  intervalSeconds: number
  now: () => number
}

/** 矛盾解消A必須事項1: `nextBatchAt` is DB-authoritative, written in the
 * same call that schedules the following Cloud Task — the client never
 * counts its own 3-second timer down from a locally-derived value. */
export const enqueueNextBatch = async (deps: EnqueueNextBatchDeps): Promise<void> => {
  const nextBatchId = computeNextBatchId(deps.lessonRunId, deps.nextBatchIndex)
  const nextBatchAtMillis = deps.now() + deps.intervalSeconds * 1000
  await deps.writeNextBatchAt({ lessonRunId: deps.lessonRunId, nextBatchAtMillis, nextBatchId })
  await deps.scheduleTask({ batchId: nextBatchId, lessonRunId: deps.lessonRunId, scheduleTimeMillis: nextBatchAtMillis })
}

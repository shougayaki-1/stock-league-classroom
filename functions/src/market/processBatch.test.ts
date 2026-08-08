import { describe, expect, it, vi } from 'vitest'
import { processBatch, type ProcessBatchDeps } from './processBatch'

/**
 * Task 9 fixes processBatch's responsibilities and interface only — the
 * real Firestore/RTDB I/O implementation lands with Task 10's Cloud
 * Tasks handler (see processBatch.ts's doc comment, and the Task 9
 * brief's Step 7). These tests only pin down that the stub exists, is
 * callable against a fully-typed ProcessBatchDeps, and fails loudly
 * (rather than silently no-op-ing) so a premature Task 10 wiring mistake
 * would be caught immediately.
 */
describe('processBatch (Task 9 stub — real behavior lands in Task 10)', () => {
  const deps: ProcessBatchDeps = {
    readLessonRunState: vi.fn(),
    listPendingOrders: vi.fn(),
    readTeamAccounts: vi.fn(),
    computeInformationImpact: vi.fn(),
    settleBatchFn: vi.fn(),
    commitSettlement: vi.fn(),
    appendBatchSettledEvent: vi.fn(),
    publishRealtimeState: vi.fn(),
    scheduleNextBatch: vi.fn(),
  }

  it('throws — not implemented until Task 10 wires the Cloud Tasks handler', async () => {
    await expect(processBatch(deps, { lessonRunId: 'run-1', batchId: 'batch-1', batchIndex: 1 }))
      .rejects.toThrow(/Task 10/)
  })

  it('does not call any dependency before real implementation lands', async () => {
    await processBatch(deps, { lessonRunId: 'run-1', batchId: 'batch-1', batchIndex: 1 }).catch(() => {})
    for (const fn of Object.values(deps)) {
      expect(fn).not.toHaveBeenCalled()
    }
  })
})

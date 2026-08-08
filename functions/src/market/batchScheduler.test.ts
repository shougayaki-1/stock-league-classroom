import { describe, expect, it, vi } from 'vitest'
import { computeNextBatchId, enqueueNextBatch, shouldProcessBatch } from './batchScheduler'

describe('computeNextBatchId', () => {
  it('is deterministic given the same lessonRunId and batchIndex — the idempotency key for Cloud Tasks at-least-once delivery', () => {
    expect(computeNextBatchId('run-1', 42)).toBe(computeNextBatchId('run-1', 42))
    expect(computeNextBatchId('run-1', 42)).toBe('run-1_batch_42')
  })
})

describe('shouldProcessBatch', () => {
  it('processes when the run is RUNNING, not paused, and this batchId has not been processed yet', () => {
    expect(shouldProcessBatch({
      status: 'RUNNING', marketPaused: false, batchId: 'run-1_batch_5', lastProcessedBatchId: 'run-1_batch_4',
    })).toBe(true)
  })

  it('does nothing for a stale task delivered after the market was paused — 矛盾解消A必須事項4', () => {
    expect(shouldProcessBatch({
      status: 'RUNNING', marketPaused: true, batchId: 'run-1_batch_5', lastProcessedBatchId: 'run-1_batch_4',
    })).toBe(false)
  })

  it('does nothing for a stale task delivered after the lessonRun ended', () => {
    expect(shouldProcessBatch({
      status: 'COMPLETED', marketPaused: false, batchId: 'run-1_batch_5', lastProcessedBatchId: 'run-1_batch_4',
    })).toBe(false)
  })

  it('does nothing for a duplicate delivery of an already-processed batchId — Cloud Tasks at-least-once delivery', () => {
    expect(shouldProcessBatch({
      status: 'RUNNING', marketPaused: false, batchId: 'run-1_batch_4', lastProcessedBatchId: 'run-1_batch_4',
    })).toBe(false)
  })
})

describe('enqueueNextBatch', () => {
  it('writes nextBatchAt to the DB and schedules the next task at exactly that time — the client counts down from nextBatchAt, never from a local timer', async () => {
    const writeNextBatchAt = vi.fn()
    const scheduleTask = vi.fn()
    await enqueueNextBatch({
      writeNextBatchAt, scheduleTask,
      lessonRunId: 'run-1', nextBatchIndex: 6, intervalSeconds: 3, now: () => 1_000_000,
    })
    const expectedNextBatchAtMillis = 1_000_000 + 3000
    expect(writeNextBatchAt).toHaveBeenCalledWith(expect.objectContaining({ nextBatchAtMillis: expectedNextBatchAtMillis }))
    expect(scheduleTask).toHaveBeenCalledWith(expect.objectContaining({
      batchId: 'run-1_batch_6', scheduleTimeMillis: expectedNextBatchAtMillis,
    }))
  })
})

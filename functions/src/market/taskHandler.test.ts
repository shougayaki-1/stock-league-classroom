import { describe, expect, it, vi } from 'vitest'
import { batchTaskHandler } from './taskHandler'

describe('batchTaskHandler', () => {
  it('skips processing and does not enqueue a follow-up task for a stale/duplicate delivery', async () => {
    const processBatch = vi.fn()
    const enqueueNextBatch = vi.fn()
    await batchTaskHandler({
      processBatch, enqueueNextBatch,
      readRunState: async () => ({ status: 'PAUSED', marketPaused: true, lastProcessedBatchId: 'run-1_batch_4' }),
      lessonRunId: 'run-1', batchId: 'run-1_batch_5', batchIndex: 5,
    })
    expect(processBatch).not.toHaveBeenCalled()
    expect(enqueueNextBatch).not.toHaveBeenCalled()
  })

  it('processes the batch and immediately enqueues the next one — the self-chain', async () => {
    const processBatch = vi.fn().mockResolvedValue(undefined)
    const enqueueNextBatch = vi.fn().mockResolvedValue(undefined)
    await batchTaskHandler({
      processBatch, enqueueNextBatch,
      readRunState: async () => ({ status: 'RUNNING', marketPaused: false, lastProcessedBatchId: 'run-1_batch_4' }),
      lessonRunId: 'run-1', batchId: 'run-1_batch_5', batchIndex: 5,
    })
    expect(processBatch).toHaveBeenCalledWith(expect.objectContaining({ batchId: 'run-1_batch_5' }))
    expect(enqueueNextBatch).toHaveBeenCalledWith(expect.objectContaining({ nextBatchIndex: 6 }))
  })

  it('enqueues the next task even if this batch produced zero fills — the chain must never depend on there being activity', async () => {
    const processBatch = vi.fn().mockResolvedValue(undefined)
    const enqueueNextBatch = vi.fn().mockResolvedValue(undefined)
    await batchTaskHandler({
      processBatch, enqueueNextBatch,
      readRunState: async () => ({ status: 'RUNNING', marketPaused: false, lastProcessedBatchId: 'run-1_batch_4' }),
      lessonRunId: 'run-1', batchId: 'run-1_batch_5', batchIndex: 5,
    })
    expect(enqueueNextBatch).toHaveBeenCalledTimes(1)
  })
})

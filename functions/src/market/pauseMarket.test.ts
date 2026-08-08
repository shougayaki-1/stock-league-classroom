import { describe, expect, it, vi } from 'vitest'
import { pauseMarket } from './pauseMarket'

describe('pauseMarket', () => {
  it('drains the currently in-flight batch before flipping marketPaused, so pre-stop orders still fill', async () => {
    const processBatch = vi.fn().mockResolvedValue(undefined)
    const setMarketPaused = vi.fn()
    const calls: string[] = []
    processBatch.mockImplementation(async () => { calls.push('processBatch') })
    setMarketPaused.mockImplementation(async () => { calls.push('setMarketPaused') })

    await pauseMarket({
      processBatch, setMarketPaused,
      readCurrentBatch: async () => ({ batchId: 'run-1_batch_9', batchIndex: 9 }),
      lessonRunId: 'run-1',
    })

    expect(calls).toEqual(['processBatch', 'setMarketPaused'])
    expect(processBatch).toHaveBeenCalledWith(expect.objectContaining({ batchId: 'run-1_batch_9' }))
  })

  it('sets marketPaused even when there is nothing pending to drain (zero orders is a valid batch)', async () => {
    const setMarketPaused = vi.fn()
    await pauseMarket({
      processBatch: vi.fn().mockResolvedValue(undefined), setMarketPaused,
      readCurrentBatch: async () => ({ batchId: 'run-1_batch_1', batchIndex: 1 }),
      lessonRunId: 'run-1',
    })
    expect(setMarketPaused).toHaveBeenCalledWith(expect.objectContaining({ lessonRunId: 'run-1', paused: true }))
  })
})

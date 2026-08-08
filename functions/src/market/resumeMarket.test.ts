import { describe, expect, it, vi } from 'vitest'
import { executeScheduledResume, resumeMarket } from './resumeMarket'

describe('resumeMarket', () => {
  it('records a resumeScheduledAtMillis and schedules a one-shot resume task for the default 30-second confirmation window', async () => {
    const recordResumeSchedule = vi.fn()
    const scheduleResumeTask = vi.fn()
    await resumeMarket({
      recordResumeSchedule, scheduleResumeTask, flipToRunning: vi.fn(),
      enqueueNextBatch: vi.fn(), readLastProcessedBatchIndex: async () => 9,
      lessonRunId: 'run-1', confirmationSeconds: 30, now: () => 1_000_000,
    })
    expect(recordResumeSchedule).toHaveBeenCalledWith(expect.objectContaining({ resumeScheduledAtMillis: 1_030_000 }))
    expect(scheduleResumeTask).toHaveBeenCalledWith(expect.objectContaining({ scheduleTimeMillis: 1_030_000 }))
  })

  it('flips to running immediately when confirmationSeconds is 0 (spec §12.26 "確認なしの即時再開")', async () => {
    const flipToRunning = vi.fn()
    const scheduleResumeTask = vi.fn()
    await resumeMarket({
      recordResumeSchedule: vi.fn(), scheduleResumeTask, flipToRunning,
      enqueueNextBatch: vi.fn(), readLastProcessedBatchIndex: async () => 9,
      lessonRunId: 'run-1', confirmationSeconds: 0, now: () => 1_000_000,
    })
    expect(flipToRunning).toHaveBeenCalledWith(expect.objectContaining({ lessonRunId: 'run-1' }))
    expect(scheduleResumeTask).not.toHaveBeenCalled()
  })

  it('also restarts the batch chain on immediate resume, not just flipToRunning', async () => {
    const enqueueNextBatch = vi.fn()
    await resumeMarket({
      recordResumeSchedule: vi.fn(), scheduleResumeTask: vi.fn(), flipToRunning: vi.fn(),
      enqueueNextBatch, readLastProcessedBatchIndex: async () => 9,
      lessonRunId: 'run-1', confirmationSeconds: 0, now: () => 1_000_000,
    })
    expect(enqueueNextBatch).toHaveBeenCalledWith(expect.objectContaining({ nextBatchIndex: 10 }))
  })
})

describe('executeScheduledResume (the one-shot task body)', () => {
  it('unpauses and restarts the batch chain from lastProcessedBatchIndex + 1', async () => {
    const flipToRunning = vi.fn()
    const enqueueNextBatch = vi.fn()
    await executeScheduledResume({
      flipToRunning, enqueueNextBatch,
      readLastProcessedBatchIndex: async () => 9,
      lessonRunId: 'run-1',
    })
    expect(flipToRunning).toHaveBeenCalledWith(expect.objectContaining({ lessonRunId: 'run-1' }))
    expect(enqueueNextBatch).toHaveBeenCalledWith(expect.objectContaining({ lessonRunId: 'run-1', nextBatchIndex: 10 }))
  })
})

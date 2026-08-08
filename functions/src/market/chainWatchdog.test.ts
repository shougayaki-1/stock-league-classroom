import { describe, expect, it } from 'vitest'
import { detectStalledRuns, STALL_DETECTION_THRESHOLD_MILLIS } from './chainWatchdog'

const baseRun = {
  lessonRunId: 'run-1', orgId: 'org-1', status: 'RUNNING', marketPaused: false, nextBatchAtMillis: 1_000_000,
}

describe('detectStalledRuns', () => {
  it('does not flag a run whose nextBatchAt is within the threshold', () => {
    const nowMillis = baseRun.nextBatchAtMillis + STALL_DETECTION_THRESHOLD_MILLIS - 1
    expect(detectStalledRuns([baseRun], nowMillis, STALL_DETECTION_THRESHOLD_MILLIS)).toEqual([])
  })

  it('flags a run whose nextBatchAt is past the threshold', () => {
    const nowMillis = baseRun.nextBatchAtMillis + STALL_DETECTION_THRESHOLD_MILLIS + 1
    expect(detectStalledRuns([baseRun], nowMillis, STALL_DETECTION_THRESHOLD_MILLIS)).toEqual([baseRun])
  })

  it('excludes a PAUSED lessonRun even if nextBatchAt is far in the past — the market chain is intentionally stopped, not stalled', () => {
    const pausedRun = { ...baseRun, status: 'PAUSED', marketPaused: true, nextBatchAtMillis: 0 }
    const nowMillis = STALL_DETECTION_THRESHOLD_MILLIS * 100
    expect(detectStalledRuns([pausedRun], nowMillis, STALL_DETECTION_THRESHOLD_MILLIS)).toEqual([])
  })
})

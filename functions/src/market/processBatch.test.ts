import { describe, expect, it, vi } from 'vitest'
import { processBatch, type ProcessBatchDeps } from './processBatch'
import type { SettleBatchResult } from './engine/settleBatch'

/**
 * Task 9 fixed processBatch's responsibilities/interface only; Task 10
 * implements the real orchestration body (this file) together with the
 * Cloud Tasks handler that calls it. These tests exercise the pure
 * orchestration against fully-mocked deps — the Admin SDK wiring
 * (`processBatchDepsWithAdminSdk`) is exercised indirectly by the rest of
 * the suite (rules/emulator tests are out of this task's unit-test layer).
 */
describe('processBatch', () => {
  const emptyResult: SettleBatchResult = { orders: [], stocks: [], teamAccountUpdates: [] }

  const makeDeps = (overrides: Partial<ProcessBatchDeps> = {}): ProcessBatchDeps => ({
    readLessonRunState: vi.fn().mockResolvedValue({
      status: 'RUNNING', marketPaused: false, randomSeed: 'seed', restoreGeneration: 0,
      priceSensitivityPreset: 'BALANCED', noiseEnabled: false,
    }),
    listPendingOrders: vi.fn().mockResolvedValue([]),
    readTeamAccounts: vi.fn().mockResolvedValue([]),
    listStocksForBatch: vi.fn().mockResolvedValue([]),
    computeInformationImpact: vi.fn().mockResolvedValue(new Map()),
    settleBatchFn: vi.fn().mockReturnValue(emptyResult),
    commitSettlement: vi.fn().mockResolvedValue(undefined),
    appendBatchSettledEvent: vi.fn().mockResolvedValue(undefined),
    publishRealtimeState: vi.fn().mockResolvedValue(undefined),
    scheduleNextBatch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  })

  it('does nothing when the lessonRun is not RUNNING (Task 11 stop)', async () => {
    const deps = makeDeps({
      readLessonRunState: vi.fn().mockResolvedValue({
        status: 'PAUSED', marketPaused: false, randomSeed: 'seed', restoreGeneration: 0,
        priceSensitivityPreset: 'BALANCED', noiseEnabled: false,
      }),
    })
    await processBatch(deps, { lessonRunId: 'run-1', batchId: 'run-1_batch_1', batchIndex: 1 })
    expect(deps.listPendingOrders).not.toHaveBeenCalled()
    expect(deps.settleBatchFn).not.toHaveBeenCalled()
  })

  it('does nothing when marketPaused is true even if status is RUNNING (矛盾解消A必須事項4)', async () => {
    const deps = makeDeps({
      readLessonRunState: vi.fn().mockResolvedValue({
        status: 'RUNNING', marketPaused: true, randomSeed: 'seed', restoreGeneration: 0,
        priceSensitivityPreset: 'BALANCED', noiseEnabled: false,
      }),
    })
    await processBatch(deps, { lessonRunId: 'run-1', batchId: 'run-1_batch_1', batchIndex: 1 })
    expect(deps.settleBatchFn).not.toHaveBeenCalled()
  })

  it('calls settleBatchFn with assembled input and passes the result through commit/append/publish', async () => {
    const settleBatchFn = vi.fn().mockReturnValue(emptyResult)
    const commitSettlement = vi.fn().mockResolvedValue(undefined)
    const appendBatchSettledEvent = vi.fn().mockResolvedValue(undefined)
    const publishRealtimeState = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps({ settleBatchFn, commitSettlement, appendBatchSettledEvent, publishRealtimeState })

    await processBatch(deps, { lessonRunId: 'run-1', batchId: 'run-1_batch_1', batchIndex: 1 })

    expect(settleBatchFn).toHaveBeenCalledWith(expect.objectContaining({
      lessonRunId: 'run-1', batchId: 'run-1_batch_1', batchIndex: 1, randomSeed: 'seed', restoreGeneration: 0,
    }))
    expect(commitSettlement).toHaveBeenCalledWith(emptyResult, 'run-1', 'run-1_batch_1')
    expect(appendBatchSettledEvent).toHaveBeenCalledWith(emptyResult, 'run-1', 'run-1_batch_1')
    expect(publishRealtimeState).toHaveBeenCalledWith(emptyResult, 'run-1')
  })

  it('calls scheduleNextBatch as the last step, per the fixed ProcessBatchDeps interface (Task 9 Step 9)', async () => {
    const scheduleNextBatch = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps({ scheduleNextBatch })
    await processBatch(deps, { lessonRunId: 'run-1', batchId: 'run-1_batch_1', batchIndex: 1 })
    expect(scheduleNextBatch).toHaveBeenCalledWith('run-1', 1)
  })

  it('assigns each stock its computed informationImpactPercent from computeInformationImpact', async () => {
    const settleBatchFn = vi.fn().mockReturnValue(emptyResult)
    const deps = makeDeps({
      listStocksForBatch: vi.fn().mockResolvedValue([
        { stockId: 'stock-a', currentPrice: 100, initialPrice: 100, priceGuard: { maxChangePercent: 10 }, effectiveMarketSize: 1000, demandSensitivity: 1 },
      ]),
      computeInformationImpact: vi.fn().mockResolvedValue(new Map([['stock-a', 2.5]])),
      settleBatchFn,
    })
    await processBatch(deps, { lessonRunId: 'run-1', batchId: 'run-1_batch_1', batchIndex: 1 })
    expect(settleBatchFn).toHaveBeenCalledWith(expect.objectContaining({
      stocks: [expect.objectContaining({ stockId: 'stock-a', informationImpactPercent: 2.5 })],
    }))
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettleBatchResult } from './engine/settleBatch'

// -----------------------------------------------------------------------------
// Exercises `publishRealtimeStateWithAdminSdk` (processBatch.ts) directly —
// the Admin SDK wiring for Task 20 (the RTDB broadcast that was left as a
// no-op through Tasks 10-19). Following the precedent in
// privacy/deletePersonalDataAdminSdk.test.ts of module-level
// vi.mock('firebase-admin/firestore'|'firebase-admin/database', ...): this
// function has no injected dependency seam (it calls getFirestore()/
// getDatabase() directly, matching every other *WithAdminSdk function in
// this file), so the module-level mock is the established way to test it
// without a real emulator.
// -----------------------------------------------------------------------------

const firestoreDocs = new Map<string, Record<string, unknown>>()
const rtdbUpdates: Array<{ path: string; data: Record<string, unknown> }> = []

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => ({
      get: async () => ({ exists: firestoreDocs.has(path), data: () => firestoreDocs.get(path) }),
    }),
  }),
}))

vi.mock('firebase-admin/database', () => ({
  getDatabase: () => ({
    ref: (path: string) => ({
      update: async (data: Record<string, unknown>) => { rtdbUpdates.push({ path, data }) },
    }),
  }),
}))

beforeEach(() => {
  firestoreDocs.clear()
  rtdbUpdates.length = 0
})

afterEach(() => {
  vi.clearAllMocks()
})

const emptyResult: SettleBatchResult = { orders: [], stocks: [], teamAccountUpdates: [] }

describe('publishRealtimeStateWithAdminSdk', () => {
  it('partially updates lessonRunPublic with only market fields (+ orgId for the RTDB rule), never overwriting Phase B fields via .set()', async () => {
    const { publishRealtimeStateWithAdminSdk } = await import('./processBatch')
    firestoreDocs.set('lessonRuns/run-1', {
      orgId: 'org-1', priceSensitivityPreset: 'BALANCED', marketPaused: false, nextBatchAtMillis: 5000,
    })

    const result: SettleBatchResult = {
      ...emptyResult,
      stocks: [{
        stockId: 'stock-1', executionPrice: 1000, nextPrice: 1050,
        breakdown: { informationPercent: 2, demandPercent: 3, otherPercent: 0.5, total: 5.5 },
        guardApplied: false, suddenChangeWarning: false, displayedVolumeShares: 42, netDemandValue: 12345,
      }],
    }

    await publishRealtimeStateWithAdminSdk(result, 'run-1')

    const publicUpdate = rtdbUpdates.find((u) => u.path === 'lessonRunPublic/run-1')
    expect(publicUpdate).toBeDefined()
    // Only market fields + orgId (required by database.rules.json's
    // lessonRunPublic read rule, `data.child('orgId')`) — no
    // status/currentPhaseId/publicTask/notifications (those belong to
    // publicProjection.ts's publishLessonProjection, and a .set() here
    // would destroy them; resumeScheduledAtMillis is omitted here since it
    // is absent from the source doc, matching the optional-field contract).
    expect(Object.keys(publicUpdate!.data).sort()).toEqual(['marketPaused', 'nextBatchAtMillis', 'orgId', 'stocks'])
    expect(publicUpdate!.data.marketPaused).toBe(false)
    expect(publicUpdate!.data.nextBatchAtMillis).toBe(5000)
    expect(publicUpdate!.data.stocks).toEqual({
      'stock-1': {
        currentPrice: 1050, previousPrice: 1000, guardApplied: false, suddenChangeWarning: false,
        breakdown: { informationPercent: 2, demandPercent: 3, otherPercent: 0.5, total: 5.5 },
        displayedVolumeShares: 42,
      },
    })
  })

  it('includes resumeScheduledAtMillis when present on the lessonRun doc (spec §12.26 confirmation window)', async () => {
    const { publishRealtimeStateWithAdminSdk } = await import('./processBatch')
    firestoreDocs.set('lessonRuns/run-1', {
      orgId: 'org-1', priceSensitivityPreset: 'BALANCED', marketPaused: false, nextBatchAtMillis: 5000,
      resumeScheduledAtMillis: 9000,
    })

    await publishRealtimeStateWithAdminSdk(emptyResult, 'run-1')

    const publicUpdate = rtdbUpdates.find((u) => u.path === 'lessonRunPublic/run-1')
    expect(publicUpdate!.data.resumeScheduledAtMillis).toBe(9000)
  })

  it('writes lessonRunPrivate with computationLog including the internal priceSensitivityPreset coefficient', async () => {
    const { publishRealtimeStateWithAdminSdk } = await import('./processBatch')
    firestoreDocs.set('lessonRuns/run-1', { orgId: 'org-1', priceSensitivityPreset: 'DEMAND_FOCUSED' })

    const result: SettleBatchResult = {
      ...emptyResult,
      stocks: [{
        stockId: 'stock-1', executionPrice: 1000, nextPrice: 1050,
        breakdown: { informationPercent: 2, demandPercent: 3, otherPercent: 0.5, total: 5.5 },
        guardApplied: false, suddenChangeWarning: false, displayedVolumeShares: 42, netDemandValue: 12345,
      }],
    }

    await publishRealtimeStateWithAdminSdk(result, 'run-1')

    const privateUpdate = rtdbUpdates.find((u) => u.path === 'lessonRunPrivate/run-1')
    expect(privateUpdate).toBeDefined()
    expect(privateUpdate!.data.orgId).toBe('org-1')
    expect(privateUpdate!.data.computationLog).toEqual({
      'stock-1': { informationImpactPercent: 2, demandImpactPercent: 3, noisePercent: 0.5, priceSensitivityPreset: 'DEMAND_FOCUSED' },
    })
  })

  it('reads the committed TeamAccount (absolute values, not deltas) and writes lessonRunTeamState per traded team', async () => {
    const { publishRealtimeStateWithAdminSdk } = await import('./processBatch')
    firestoreDocs.set('lessonRuns/run-1', { orgId: 'org-1', priceSensitivityPreset: 'BALANCED' })
    firestoreDocs.set('lessonRuns/run-1/teamAccounts/team-1', {
      teamId: 'team-1', cash: 90000, holdings: { 'stock-1': 10 },
      lockedBuyValue: 0, lockedSellQuantity: {}, updatedAtServerMillis: 123,
    })
    firestoreDocs.set('lessonRuns/run-1/orders/order-1', {
      orderId: 'order-1', teamId: 'team-1', stockId: 'stock-1', side: 'BUY',
      quantity: 10, referencePrice: 1000, status: 'FILLED', executionPrice: 1050,
      idempotencyKey: 'k', lessonRunId: 'run-1', batchId: 'run-1_batch_1', submittedAtServerMillis: 1,
    })

    const result: SettleBatchResult = {
      orders: [{ orderId: 'order-1', status: 'FILLED', executionPrice: 1050 }],
      stocks: [],
      teamAccountUpdates: [{ teamId: 'team-1', cashDelta: -10500, holdingsDelta: { 'stock-1': 10 } }],
    }

    await publishRealtimeStateWithAdminSdk(result, 'run-1')

    const teamUpdate = rtdbUpdates.find((u) => u.path === 'lessonRunTeamState/run-1/team-1')
    expect(teamUpdate).toBeDefined()
    // Absolute cash/holdings from the re-read TeamAccount doc, not the delta.
    expect(teamUpdate!.data.cash).toBe(90000)
    expect(teamUpdate!.data.holdings).toEqual({ 'stock-1': 10 })
    expect(teamUpdate!.data.myOrders).toEqual([
      { orderId: 'order-1', stockId: 'stock-1', side: 'BUY', quantity: 10, status: 'FILLED', referencePrice: 1000, executionPrice: 1050 },
    ])
  })

  it('does not write lessonRunTeamState for a team with no teamAccountUpdates this batch', async () => {
    const { publishRealtimeStateWithAdminSdk } = await import('./processBatch')
    firestoreDocs.set('lessonRuns/run-1', { orgId: 'org-1', priceSensitivityPreset: 'BALANCED' })

    await publishRealtimeStateWithAdminSdk(emptyResult, 'run-1')

    expect(rtdbUpdates.some((u) => u.path.startsWith('lessonRunTeamState/'))).toBe(false)
  })
})

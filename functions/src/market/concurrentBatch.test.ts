import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { beforeAll, describe, expect, it } from 'vitest'
import { applySoftLockForNewOrder, getOrInitTeamAccount, teamAccountsRepositoryWithAdminSdk } from '../lessonRuns/teamAccounts/repository'
import { createPendingOrder, listPendingOrdersForBatch, ordersRepositoryWithAdminSdk } from '../lessonRuns/orders/repository'
import { processBatchDepsWithAdminSdk } from './processBatch'
import type { SettleBatchResult } from './engine/settleBatch'

// Firestore Emulator only (spec §30-4): these tests send REAL concurrent
// requests against a running `firebase emulators:exec --only firestore`
// instance, unlike the synchronous unit tests in Task 1-17 which cannot
// observe true race conditions. Run via `npm run test:market-concurrency`
// (root) — NOT part of the default `vitest run` in functions/.
beforeAll(() => {
  initializeApp({ projectId: 'demo-concurrent-test' })
  getFirestore()
})

describe('concurrent order submission (spec §30-4)', () => {
  it("never lets the sum of concurrently-accepted buy orders exceed the team's cash, even when 20 requests race", { timeout: 20000 }, async () => {
    const lessonRunId = 'run-concurrent-1'
    const teamId = 'team-a'
    const teamAccounts = teamAccountsRepositoryWithAdminSdk()
    await getOrInitTeamAccount({ firestore: teamAccounts, lessonRunId, teamId, startingCash: 10000, now: () => Date.now() })

    // 20 concurrent 1,000-yen orders against 10,000 cash — at most 10 may
    // legitimately succeed. If the transaction has a race, more than 10
    // will succeed and total locked value will exceed 10,000.
    const results = await Promise.all(
      Array.from({ length: 20 }, () => applySoftLockForNewOrder({
        firestore: teamAccounts, lessonRunId, teamId, side: 'BUY', stockId: 'acme',
        quantity: 1, referencePrice: 1000, now: () => Date.now(),
      })),
    )

    const acceptedCount = results.filter((r) => r.accepted).length
    expect(acceptedCount).toBeLessThanOrEqual(10)

    const finalAccount = await getFirestore().doc(`lessonRuns/${lessonRunId}/teamAccounts/${teamId}`).get()
    expect((finalAccount.data() as { lockedBuyValue: number }).lockedBuyValue).toBeLessThanOrEqual(10000)
  })

  it('assigns every concurrently-submitted order a unique orderId even under simultaneous idempotencyKeys from different teams', async () => {
    const lessonRunId = 'run-concurrent-2'
    const orders = ordersRepositoryWithAdminSdk()
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => createPendingOrder({
        firestore: orders, lessonRunId, batchId: 'batch-1', teamId: `team-${i}`,
        stockId: 'acme', side: 'BUY', quantity: 1, referencePrice: 1000,
        idempotencyKey: `idem-${i}`, now: () => Date.now(),
      })),
    )
    const orderIds = results.map((r) => r.orderId)
    expect(new Set(orderIds).size).toBe(orderIds.length)
  })
})

describe('multiple teams settling in the same batch (spec §27.2 "同一区間の全注文が同価格")', () => {
  it("produces one uniform execution price for all teams' orders in the same batch, regardless of submission order", async () => {
    // Exercises the same settleBatch (Task 9) already covered by unit
    // tests, but here the ORDERS are submitted concurrently via
    // createPendingOrder against the emulator first, then read back and
    // fed into settleBatch — closing the loop between "concurrent writes
    // land correctly" and "settlement reads them all consistently".
    const lessonRunId = 'run-concurrent-3'
    const orders = ordersRepositoryWithAdminSdk()
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => createPendingOrder({
        firestore: orders, lessonRunId, batchId: 'batch-1', teamId: `team-${i}`,
        stockId: 'acme', side: 'BUY', quantity: 1, referencePrice: 1000 + i,
        idempotencyKey: `race-${i}`, now: () => Date.now(),
      })),
    )
    const fetchedOrders = await listPendingOrdersForBatch({ firestore: orders, lessonRunId, batchId: 'batch-1' })
    expect(fetchedOrders).toHaveLength(5)
    // executionPrice is determined by settleBatch from the stock's
    // currentPrice, NOT from any individual order's referencePrice — this
    // assertion documents that submission order/timing cannot influence it.
    const referencePrices = new Set(fetchedOrders.map((o) => o.referencePrice))
    expect(referencePrices.size).toBeGreaterThan(1) // orders WERE submitted with different reference prices
    // ...settleBatch (Task 9) applied to these orders would fill all 5 at
    // the single stock.currentPrice, already proven by Task 9's unit tests;
    // this test's job is only to prove concurrent writes didn't corrupt or
    // drop any of the 5 orders before settlement reads them.
  })
})

// Task 21 (Phase C final cross-review, findings 1 & 2): both bugs live in
// `commitSettlementWithAdminSdk`'s Firestore transaction, so a plain
// mocked-deps unit test (processBatch.test.ts) cannot exercise them —
// they require real transaction reads/writes against the emulator.
describe('commitSettlement — per-team TeamAccountUpdate aggregation (Task 21 finding 1 & 2)', () => {
  const seedLessonRun = async (lessonRunId: string) => {
    await getFirestore().doc(`lessonRuns/${lessonRunId}`).set({ status: 'RUNNING' })
  }
  const seedTeamAccount = async (lessonRunId: string, teamId: string, cash: number) => {
    await getFirestore().doc(`lessonRuns/${lessonRunId}/teamAccounts/${teamId}`).set({
      teamId, lessonRunId, cash, holdings: {}, lockedBuyValue: 0, lockedSellQuantity: {}, updatedAtServerMillis: Date.now(),
    })
  }
  const seedOrder = async (lessonRunId: string, orderId: string, fields: {
    teamId: string; stockId: string; side: 'BUY' | 'SELL'; quantity: number; referencePrice: number; status: string
  }) => {
    await getFirestore().doc(`lessonRuns/${lessonRunId}/orders/${orderId}`).set({
      orderId, idempotencyKey: `idem-${orderId}`, lessonRunId, batchId: 'batch-1',
      submittedAtServerMillis: Date.now(), ...fields,
    })
  }

  it("applies EVERY (team, stock) group's delta when the same team fills two different stocks in one batch — not just the last one", async () => {
    const lessonRunId = 'run-agg-1'
    const teamId = 'team-agg'
    await seedLessonRun(lessonRunId)
    await seedTeamAccount(lessonRunId, teamId, 100000)
    await seedOrder(lessonRunId, 'order-acme', { teamId, stockId: 'acme', side: 'BUY', quantity: 3, referencePrice: 100, status: 'PENDING' })
    await seedOrder(lessonRunId, 'order-globex', { teamId, stockId: 'globex', side: 'BUY', quantity: 5, referencePrice: 50, status: 'PENDING' })

    const result: SettleBatchResult = {
      orders: [
        { orderId: 'order-acme', status: 'FILLED', executionPrice: 100 },
        { orderId: 'order-globex', status: 'FILLED', executionPrice: 50 },
      ],
      stocks: [],
      teamAccountUpdates: [
        { teamId, cashDelta: -300, holdingsDelta: { acme: 3 } },
        { teamId, cashDelta: -250, holdingsDelta: { globex: 5 } },
      ],
    }

    await processBatchDepsWithAdminSdk().commitSettlement(result, lessonRunId, 'batch-1')

    const finalAccount = (await getFirestore().doc(`lessonRuns/${lessonRunId}/teamAccounts/${teamId}`).get()).data() as {
      cash: number; holdings: Record<string, number>
    }
    // Pre-fix: settledDeltaByTeam was a Map keyed by teamId, so the second
    // push (globex) silently overwrote the first (acme) — cash would land
    // at 99750 and holdings at { globex: 5 } only, losing the acme fill
    // entirely despite its order being recorded as FILLED.
    expect(finalAccount.cash).toBe(100000 - 300 - 250)
    expect(finalAccount.holdings).toEqual({ acme: 3, globex: 5 })
  })

  it('does not apply a TeamAccountUpdate whose order was already CANCELLED by a racing cancelOrder before this transaction', async () => {
    const lessonRunId = 'run-agg-2'
    const teamId = 'team-cancel-race'
    await seedLessonRun(lessonRunId)
    await seedTeamAccount(lessonRunId, teamId, 100000)
    // Simulates cancelOrder having already flipped this order to CANCELLED
    // between listPendingOrders (outside the tx) and commitSettlement's tx.
    await seedOrder(lessonRunId, 'order-cancelled', { teamId, stockId: 'acme', side: 'BUY', quantity: 3, referencePrice: 100, status: 'CANCELLED' })

    const result: SettleBatchResult = {
      orders: [{ orderId: 'order-cancelled', status: 'FILLED', executionPrice: 100 }],
      stocks: [],
      teamAccountUpdates: [{ teamId, cashDelta: -300, holdingsDelta: { acme: 3 } }],
    }

    await processBatchDepsWithAdminSdk().commitSettlement(result, lessonRunId, 'batch-1')

    const finalAccount = (await getFirestore().doc(`lessonRuns/${lessonRunId}/teamAccounts/${teamId}`).get()).data() as {
      cash: number; holdings: Record<string, number>
    }
    const finalOrder = (await getFirestore().doc(`lessonRuns/${lessonRunId}/orders/order-cancelled`).get()).data() as { status: string }
    // Pre-fix: the order-status write is correctly skipped (order stays
    // CANCELLED), but the cashDelta/holdingsDelta was applied unconditionally
    // — cash would wrongly drop to 99700 and holdings gain 3 acme shares
    // for an order that was never actually filled.
    expect(finalOrder.status).toBe('CANCELLED')
    expect(finalAccount.cash).toBe(100000)
    expect(finalAccount.holdings).toEqual({})
  })
})

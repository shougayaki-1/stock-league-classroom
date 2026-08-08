import { getFirestore } from 'firebase-admin/firestore'
import { getDatabase } from 'firebase-admin/database'
import type { MarketOrder } from './orderTypes'
import { listPendingOrdersForBatch, ordersRepositoryWithAdminSdk } from '../lessonRuns/orders/repository'
import { appendLessonEventWithAdminSdk } from '../lessonRuns/appendLessonEvent'
import type { TeamAccount } from '../lessonRuns/teamAccounts/types'
import { settleBatch, type SettleBatchInput, type SettleBatchResult, type StockBatchInput } from './engine/settleBatch'
import type { PriceSensitivityPreset } from './engine/priceCalculation'
import { toComputationLog, toMyOrdersView, toStockPublicStates } from './realtimeProjection'
import {
  applyLifecycleDividendsWithAdminSdk,
  applyLifecycleStockSplitsWithAdminSdk,
  readLifecycleConfigWithAdminSdk,
  type LifecycleConfig,
} from './lifecycleEvents'

/**
 * `processBatch` is the Admin SDK wrapper around the pure `settleBatch`
 * orchestrator (Task 9). It is the entry point Task 10's Cloud Tasks
 * handler (`taskHandler.ts`'s `batchTaskHandler`) calls once per batch
 * deadline.
 *
 * The nine steps below (spec §12.9〜§12.11・§12.14・§12.15・§12.20〜§12.22)
 * map onto `ProcessBatchDeps`'s methods, in the order `processBatch`
 * calls them:
 *
 * 1. readLessonRunState  — read `lessonRuns/{id}`'s status/randomSeed/
 *    restoreGeneration/pricing config. If `status !== 'RUNNING'` or
 *    `marketPaused === true`, processBatch does nothing (Task 11 stop /
 *    Task 10 chain-breaking). This mirrors `shouldProcessBatch`'s guard
 *    in `batchScheduler.ts` — `batchTaskHandler` already checks this
 *    before calling `processBatch`, but the check is repeated here as
 *    defense in depth in case `processBatch` is ever invoked directly.
 * 2. listPendingOrders    — Task 5's `listPendingOrdersForBatch`.
 * 3. readTeamAccounts     — Task 7's `TeamAccount` docs, one per team
 *    with orders this batch.
 * 4. listStocksForBatch + computeInformationImpact — per stock, the
 *    latest persisted price/authoring state plus the summed
 *    `informationImpactPercent` from active information items and
 *    published economic indicators (Task 9's `informationImpact.ts`
 *    window function). NOTE: `computeInformationImpact` currently
 *    returns an empty map — no prior task built Firestore persistence
 *    for `InformationItem`s, so there is nothing to read yet. This is a
 *    documented gap (see task-10-report.md), not a silent omission: it
 *    means published-information effects on price are not yet live,
 *    but noise/demand-driven price movement and the batch chain itself
 *    both work end-to-end.
 * 5. settleBatch          — call the pure orchestrator (Task 9) with the
 *    data steps 1-4 assembled.
 * 6. commitSettlement     — inside a single Firestore transaction (all
 *    reads before all writes, per the Global Constraints transaction
 *    rule): transition each order from PENDING to FILLED/REJECTED,
 *    release its original soft lock, apply each `TeamAccountUpdate`, and
 *    update each stock's `currentPrice`.
 * 6.5. lifecycle events (Task 17, spec §12.28/§12.29, default OFF) — a
 *    thin flag branch, NOT a change to `settleBatch` itself: reads
 *    `SocialStudiesMarketContent`'s dividend/stock-split flags +
 *    `*TriggerBatchIndexes` for this lessonRun, and only when a flag is
 *    `true` AND this batch's index is in its trigger list does it call
 *    the corresponding `applyLifecycle*` dep. Bankruptcy is deliberately
 *    NOT wired here — it is an explicit one-off teacher action
 *    (`triggerBankruptcyCallable`, `onCall.ts`) that never routes through
 *    `processBatch`, so the batch flow is unaffected by `bankruptcyEnabled`
 *    either way. When all flags are false/empty (the default), this step
 *    reads one doc and calls nothing else — zero effect on the normal
 *    flow.
 * 7. appendBatchSettledEvent — record a `BATCH_SETTLED` `LessonEvent`
 *    (batchId, price breakdown, rejection count) via Phase A's
 *    `appendLessonEvent`.
 * 8. publishRealtimeState — update RTDB `lessonRunPublic`/
 *    `lessonRunPrivate`/`lessonRunTeamState` projections. TODO(Task 13):
 *    the RTDB write schema is confirmed by Task 13, not this task — this
 *    is intentionally a no-op placeholder per this task's brief ("RTDB
 *    書き込みスキーマの詳細はTask13で確定するため、最小限のプレースホルダ
 *    ...で構わない").
 * 9. scheduleNextBatch    — INTENTIONALLY A NO-OP in the real Admin SDK
 *    wiring below. `ProcessBatchDeps` still requires this method (Task 9
 *    fixed the interface), but Task 10's `batchTaskHandler` already
 *    calls `enqueueNextBatch` itself immediately after `processBatch`
 *    returns (see `taskHandler.ts`). Having both call the real
 *    `enqueueNextBatch` would schedule two Cloud Tasks for the same next
 *    batchIndex. This file's `processBatchDepsWithAdminSdk` wires
 *    `scheduleNextBatch` to a no-op to resolve that overlap in favor of
 *    the single call site `batchTaskHandler` already owns.
 */
export interface ProcessBatchDeps {
  readLessonRunState: (lessonRunId: string) => Promise<{
    status: string
    marketPaused?: boolean
    randomSeed: string
    restoreGeneration: number
    priceSensitivityPreset: PriceSensitivityPreset
    noiseEnabled: boolean
  }>
  listPendingOrders: (lessonRunId: string, batchId: string) => Promise<MarketOrder[]>
  readTeamAccounts: (lessonRunId: string, teamIds: string[]) => Promise<SettleBatchInput['teamAccounts']>
  /** Per-stock price/authoring state as of the start of this batch —
   * everything `StockBatchInput` needs except `informationImpactPercent`
   * (added separately from `computeInformationImpact`'s result). */
  listStocksForBatch: (lessonRunId: string) => Promise<Array<Omit<StockBatchInput, 'informationImpactPercent'>>>
  computeInformationImpact: (lessonRunId: string, batchIndex: number) => Promise<Map<string, number>>
  settleBatchFn: (input: SettleBatchInput) => SettleBatchResult
  commitSettlement: (result: SettleBatchResult, lessonRunId: string, batchId: string) => Promise<void>
  appendBatchSettledEvent: (result: SettleBatchResult, lessonRunId: string, batchId: string) => Promise<void>
  publishRealtimeState: (result: SettleBatchResult, lessonRunId: string) => Promise<void>
  scheduleNextBatch: (lessonRunId: string, batchIndex: number) => Promise<void>
  /** Task 17 — `SocialStudiesMarketContent`'s lifecycle-event flags for
   * this lessonRun. Default (all flags false, empty trigger arrays) means
   * `applyLifecycleDividends`/`applyLifecycleStockSplits` below are never
   * called. */
  readLifecycleConfig: (lessonRunId: string) => Promise<LifecycleConfig>
  /** Task 17 — pays every team a dividend, called only when
   * `dividendEnabled` and the current batchIndex is in
   * `dividendTriggerBatchIndexes`. */
  applyLifecycleDividends: (input: { lessonRunId: string; dividendPerShareYen: number }) => Promise<void>
  /** Task 17 — splits every stock's price and holdings, called only when
   * `stockSplitEnabled` and the current batchIndex is in
   * `stockSplitTriggerBatchIndexes`. */
  applyLifecycleStockSplits: (input: { lessonRunId: string; splitRatio: number }) => Promise<void>
}

export interface ProcessBatchInput {
  lessonRunId: string
  batchId: string
  batchIndex: number
}

export const processBatch = async (deps: ProcessBatchDeps, input: ProcessBatchInput): Promise<void> => {
  const runState = await deps.readLessonRunState(input.lessonRunId)
  if (runState.status !== 'RUNNING' || runState.marketPaused === true) return

  const orders = await deps.listPendingOrders(input.lessonRunId, input.batchId)
  const teamIds = [...new Set(orders.map((order) => order.teamId))]
  const [teamAccounts, stocksBase, impactByStock] = await Promise.all([
    deps.readTeamAccounts(input.lessonRunId, teamIds),
    deps.listStocksForBatch(input.lessonRunId),
    deps.computeInformationImpact(input.lessonRunId, input.batchIndex),
  ])

  const stocks: StockBatchInput[] = stocksBase.map((stock) => ({
    ...stock,
    informationImpactPercent: impactByStock.get(stock.stockId) ?? 0,
  }))

  const result = deps.settleBatchFn({
    lessonRunId: input.lessonRunId,
    batchId: input.batchId,
    batchIndex: input.batchIndex,
    randomSeed: runState.randomSeed,
    restoreGeneration: runState.restoreGeneration,
    priceSensitivityPreset: runState.priceSensitivityPreset,
    noiseEnabled: runState.noiseEnabled,
    stocks,
    orders: orders.map((order) => ({
      orderId: order.orderId, teamId: order.teamId, stockId: order.stockId,
      side: order.side, quantity: order.quantity, referencePrice: order.referencePrice,
    })),
    teamAccounts,
  })

  await deps.commitSettlement(result, input.lessonRunId, input.batchId)

  // Task 17 (spec §12.28/§12.29) — thin, default-off flag branch. See this
  // file's doc comment step 6.5 for why bankruptcy is deliberately absent
  // here.
  const lifecycleConfig = await deps.readLifecycleConfig(input.lessonRunId)
  if (lifecycleConfig.dividendEnabled && lifecycleConfig.dividendTriggerBatchIndexes.includes(input.batchIndex)) {
    await deps.applyLifecycleDividends({ lessonRunId: input.lessonRunId, dividendPerShareYen: lifecycleConfig.dividendPerShareYen })
  }
  if (lifecycleConfig.stockSplitEnabled && lifecycleConfig.stockSplitTriggerBatchIndexes.includes(input.batchIndex)) {
    await deps.applyLifecycleStockSplits({ lessonRunId: input.lessonRunId, splitRatio: lifecycleConfig.stockSplitRatio })
  }

  await deps.appendBatchSettledEvent(result, input.lessonRunId, input.batchId)
  await deps.publishRealtimeState(result, input.lessonRunId)
  // Task 9 Step 9 requires this call; see this file's doc comment item 9
  // for why the real Admin SDK wiring (processBatchDepsWithAdminSdk)
  // supplies a no-op here instead of the real enqueueNextBatch.
  await deps.scheduleNextBatch(input.lessonRunId, input.batchIndex)
}

// ---------------------------------------------------------------------
// Admin SDK wiring
// ---------------------------------------------------------------------

const readLessonRunStateWithAdminSdk: ProcessBatchDeps['readLessonRunState'] = async (lessonRunId) => {
  const snap = await getFirestore().doc(`lessonRuns/${lessonRunId}`).get()
  const data = (snap.data() ?? {}) as {
    status?: string
    marketPaused?: boolean
    randomSeed?: string
    restoreGeneration?: number
    priceSensitivityPreset?: PriceSensitivityPreset
    noiseEnabled?: boolean
  }
  return {
    status: data.status ?? 'UNKNOWN',
    marketPaused: data.marketPaused ?? false,
    randomSeed: data.randomSeed ?? '',
    restoreGeneration: data.restoreGeneration ?? 0,
    // PROVISIONAL defaults — no prior task wired a per-lessonRun field for
    // these onto LessonRun yet (same gap Task 9's file doc noted for
    // socialStudiesMarket authoring content). 'BALANCED'/noise-off keeps
    // settleBatch callable without inventing an authoring-content schema
    // this task does not own.
    priceSensitivityPreset: data.priceSensitivityPreset ?? 'BALANCED',
    noiseEnabled: data.noiseEnabled ?? false,
  }
}

const readTeamAccountsWithAdminSdk: ProcessBatchDeps['readTeamAccounts'] = async (lessonRunId, teamIds) => {
  if (teamIds.length === 0) return []
  const db = getFirestore()
  const snaps = await Promise.all(teamIds.map((teamId) => db.doc(`lessonRuns/${lessonRunId}/teamAccounts/${teamId}`).get()))
  return snaps
    .filter((snap) => snap.exists)
    .map((snap) => {
      const account = snap.data() as TeamAccount
      return { teamId: account.teamId, cash: account.cash, holdings: account.holdings }
    })
}

/**
 * PROVISIONAL schema: `lessonRuns/{id}/stocks/{stockId}` holding
 * currentPrice/initialPrice/priceGuard/effectiveMarketSize/
 * demandSensitivity. No prior task (Task 1-9) created a live per-lessonRun
 * stock-state collection — only authoring-time content types
 * (`SimulatedCompany` etc.) exist in `market-authoring-content`. This
 * collection path is this task's minimal placeholder so `settleBatch` has
 * something to read/write; Task 13 owns confirming/adjusting this schema
 * when it wires the RTDB projections that mirror it.
 */
const listStocksForBatchWithAdminSdk: ProcessBatchDeps['listStocksForBatch'] = async (lessonRunId) => {
  const snap = await getFirestore().collection(`lessonRuns/${lessonRunId}/stocks`).get()
  return snap.docs.map((doc) => doc.data() as Omit<StockBatchInput, 'informationImpactPercent'>)
}

/**
 * TODO(Task 13 or a dedicated information-items task): no prior task
 * persisted `InformationItem`s to Firestore, so there is nothing to sum
 * here yet. Returns an empty map — every stock's informationImpactPercent
 * contribution from published information/economic-indicator content is
 * currently 0, not "unknown." See this file's doc comment step 4.
 */
const computeInformationImpactWithAdminSdk: ProcessBatchDeps['computeInformationImpact'] = async () => new Map()

const commitSettlementWithAdminSdk: ProcessBatchDeps['commitSettlement'] = async (result, lessonRunId, batchId) => {
  const db = getFirestore()
  await db.runTransaction(async (tx) => {
    // ---- ALL READS FIRST (Global Constraints transaction rule) ----
    // The lessonRun doc's lastProcessedBatchId is this batchId's
    // idempotency compare-and-set (矛盾解消A必須事項2): read+check+write
    // it in THIS SAME transaction as every other settlement write, so a
    // duplicate Cloud Tasks delivery that raced past batchTaskHandler's
    // own (non-transactional) shouldProcessBatch check still cannot
    // double-settle — the second delivery's transaction sees
    // lastProcessedBatchId already equal to this batchId and no-ops.
    const lessonRunRef = db.doc(`lessonRuns/${lessonRunId}`)
    const lessonRunSnap = await tx.get(lessonRunRef)
    const alreadyProcessed = (lessonRunSnap.data() as { lastProcessedBatchId?: string } | undefined)?.lastProcessedBatchId === batchId
    if (alreadyProcessed) return

    const orderRefs = result.orders.map((o) => db.doc(`lessonRuns/${lessonRunId}/orders/${o.orderId}`))
    const orderSnaps = await Promise.all(orderRefs.map((ref) => tx.get(ref)))

    const teamIds = new Set<string>()
    orderSnaps.forEach((snap) => { if (snap.exists) teamIds.add((snap.data() as MarketOrder).teamId) })
    result.teamAccountUpdates.forEach((u) => teamIds.add(u.teamId))
    const teamIdList = [...teamIds]
    const teamRefs = teamIdList.map((teamId) => db.doc(`lessonRuns/${lessonRunId}/teamAccounts/${teamId}`))
    const teamSnaps = await Promise.all(teamRefs.map((ref) => tx.get(ref)))

    const stockRefs = result.stocks.map((s) => db.doc(`lessonRuns/${lessonRunId}/stocks/${s.stockId}`))
    const stockSnaps = await Promise.all(stockRefs.map((ref) => tx.get(ref)))

    // ---- Derive per-team soft-lock release from the ORIGINAL orders ----
    // (must use each order's own quantity/referencePrice/side/stockId —
    // the same values applySoftLockForNewOrder locked at submission time).
    const releaseByTeam = new Map<string, { lockedBuyValueRelease: number; lockedSellRelease: Record<string, number> }>()
    orderSnaps.forEach((snap) => {
      if (!snap.exists) return
      const order = snap.data() as MarketOrder
      if (order.status !== 'PENDING') return // already moved by a concurrent cancel — leave its lock alone
      const entry = releaseByTeam.get(order.teamId) ?? { lockedBuyValueRelease: 0, lockedSellRelease: {} }
      if (order.side === 'BUY') {
        entry.lockedBuyValueRelease += order.quantity * order.referencePrice
      } else {
        entry.lockedSellRelease[order.stockId] = (entry.lockedSellRelease[order.stockId] ?? 0) + order.quantity
      }
      releaseByTeam.set(order.teamId, entry)
    })

    // ---- ALL WRITES AFTER ----
    orderSnaps.forEach((snap, i) => {
      if (!snap.exists) return
      const order = snap.data() as MarketOrder
      // Compare-and-set on PENDING: if a concurrent cancelOrder already
      // moved this order away from PENDING, this settlement must not
      // overwrite that outcome (mirrors transitionOrderStatus's guard).
      if (order.status !== 'PENDING') return
      const outcome = result.orders[i]
      tx.update(orderRefs[i], {
        status: outcome.status,
        settledAtServerMillis: Date.now(),
        ...(outcome.executionPrice !== undefined ? { executionPrice: outcome.executionPrice } : {}),
        ...(outcome.rejectionReason !== undefined ? { rejectionReason: outcome.rejectionReason } : {}),
      })
    })

    const settledDeltaByTeam = new Map(result.teamAccountUpdates.map((u) => [u.teamId, u]))
    teamIdList.forEach((teamId, i) => {
      const snap = teamSnaps[i]
      if (!snap.exists) return
      const account = snap.data() as TeamAccount
      const release = releaseByTeam.get(teamId)
      const settled = settledDeltaByTeam.get(teamId)
      const holdings = { ...account.holdings }
      let cash = account.cash
      let lockedBuyValue = account.lockedBuyValue
      const lockedSellQuantity = { ...account.lockedSellQuantity }
      if (release) {
        lockedBuyValue -= release.lockedBuyValueRelease
        for (const [stockId, qty] of Object.entries(release.lockedSellRelease)) {
          lockedSellQuantity[stockId] = (lockedSellQuantity[stockId] ?? 0) - qty
        }
      }
      if (settled) {
        cash += settled.cashDelta
        for (const [stockId, delta] of Object.entries(settled.holdingsDelta)) {
          holdings[stockId] = (holdings[stockId] ?? 0) + delta
        }
      }
      tx.set(teamRefs[i], { ...account, cash, holdings, lockedBuyValue, lockedSellQuantity, updatedAtServerMillis: Date.now() })
    })

    result.stocks.forEach((s, i) => {
      const snap = stockSnaps[i]
      if (!snap.exists) return
      tx.update(stockRefs[i], { currentPrice: s.nextPrice, updatedAtServerMillis: Date.now() })
    })

    // Marks this batchId processed — the compare-and-set this
    // transaction's leading read checked above. Written last so a
    // transaction that aborts partway (e.g. a read contention retry)
    // never marks a batch processed without its settlement writes.
    tx.update(lessonRunRef, { lastProcessedBatchId: batchId })
  })
}

const appendBatchSettledEventWithAdminSdk: ProcessBatchDeps['appendBatchSettledEvent'] = async (result, lessonRunId, batchId) => {
  const orgSnap = await getFirestore().doc(`lessonRuns/${lessonRunId}`).get()
  const orgId = (orgSnap.data() as { orgId?: string } | undefined)?.orgId ?? ''
  const rejectionCount = result.orders.filter((o) => o.status === 'REJECTED').length
  await appendLessonEventWithAdminSdk({
    lessonRunId, orgId, type: 'BATCH_SETTLED', actorType: 'SYSTEM',
    payload: {
      batchId, rejectionCount,
      stocks: result.stocks.map((s) => ({ stockId: s.stockId, executionPrice: s.executionPrice, nextPrice: s.nextPrice })),
    },
    idempotencyKey: `batch-settled_${batchId}`,
  })
}

/**
 * Task 20 — broadcasts this batch's `SettleBatchResult` to the three RTDB
 * projections `lessonRunPublic`/`lessonRunPrivate`/`lessonRunTeamState`
 * own (database.rules.json). Called by `processBatch` AFTER
 * `commitSettlement`'s Firestore transaction has committed (see this
 * file's step-8 doc comment), so every Firestore read below observes this
 * batch's final, committed state.
 *
 * Field-ownership discipline (this task's brief, mandatory):
 * - `lessonRunPublic/{lessonRunId}` already carries non-market fields
 *   written by Phase B's `publishLessonProjectionWithAdminSdk`
 *   (status/currentPhaseId/publicTask/notifications, via `.set()`). This
 *   function must never call `.set()` on that node — only `ref(...).update()`
 *   with the market-owned fields (`marketPaused`/`nextBatchAtMillis`/
 *   `resumeScheduledAtMillis`/`stocks`), a multi-path RTDB update that
 *   leaves sibling keys untouched. `orgId` is also written here (not part
 *   of `LessonRunPublicState`'s market fields, but required by
 *   `database.rules.json`'s `lessonRunPublic` read rule, which reads
 *   `data.child('orgId')` off this same node) so a lessonRun whose first
 *   RTDB write is a batch settlement — before Phase B's projection ever
 *   ran — is still readable.
 * - `lessonRunPrivate/{lessonRunId}` has no other writer today (verified:
 *   only `privacy/deletePersonalData.ts` nulls it on hard delete) but is
 *   still written via `update()` for the same non-destructive discipline,
 *   plus the same `orgId` requirement as above (the rule's teacher-read
 *   branch reads `data.child('orgId')` off this node too).
 * - `lessonRunTeamState/{lessonRunId}/{teamId}` is written only for teams
 *   present in `result.teamAccountUpdates` (this batch's traders) — a team
 *   untouched this batch keeps its previous state untouched, per this
 *   task's brief ("このバッチで何らかの更新があったチームのみ書き込む最小
 *   実装で構わない"). `cash`/`holdings` are the ABSOLUTE values from the
 *   just-committed `TeamAccount` doc (re-read after `commitSettlement`),
 *   never `result.teamAccountUpdates`' deltas directly — see this task's
 *   brief for why the delta cannot be broadcast as-is. `myOrders` covers
 *   only this batch's orders (re-read individually by orderId from
 *   `result.orders`, since `OrderSettlementOutcome` itself carries no
 *   teamId/stockId/side/quantity) — see task-20-report.md for why a
 *   full-history query was judged unnecessary scope for this task.
 */
export const publishRealtimeStateWithAdminSdk: ProcessBatchDeps['publishRealtimeState'] = async (result, lessonRunId) => {
  const db = getFirestore()
  const rtdb = getDatabase()

  const lessonRunSnap = await db.doc(`lessonRuns/${lessonRunId}`).get()
  const lessonRunData = (lessonRunSnap.data() ?? {}) as {
    orgId?: string
    priceSensitivityPreset?: PriceSensitivityPreset
    marketPaused?: boolean
    nextBatchAtMillis?: number | null
    resumeScheduledAtMillis?: number
    randomSeed?: string
    restoreGeneration?: number
    lastProcessedBatchId?: string
  }
  const orgId = lessonRunData.orgId ?? ''
  const priceSensitivityPreset = lessonRunData.priceSensitivityPreset ?? 'BALANCED'

  // ---- lessonRunPublic: market-owned fields only, via update() ----
  await rtdb.ref(`lessonRunPublic/${lessonRunId}`).update({
    orgId,
    marketPaused: lessonRunData.marketPaused ?? false,
    nextBatchAtMillis: lessonRunData.nextBatchAtMillis ?? null,
    ...(lessonRunData.resumeScheduledAtMillis !== undefined
      ? { resumeScheduledAtMillis: lessonRunData.resumeScheduledAtMillis }
      : {}),
    stocks: toStockPublicStates(result.stocks),
  })

  // ---- lessonRunPrivate: teacher-only, via update() ----
  // `randomSeed`/`restoreGeneration`/`lastProcessedBatchId` are read back
  // from the SAME `lessonRuns/{id}` doc `commitSettlement` (called before
  // this function, per processBatch's step ordering) already wrote
  // `lastProcessedBatchId` onto — this mirrors that Firestore-authoritative
  // state onto RTDB rather than recomputing it.
  await rtdb.ref(`lessonRunPrivate/${lessonRunId}`).update({
    orgId,
    randomSeed: lessonRunData.randomSeed ?? '',
    restoreGeneration: lessonRunData.restoreGeneration ?? 0,
    updatedAtMillis: Date.now(),
    lastProcessedBatchId: lessonRunData.lastProcessedBatchId ?? null,
    computationLog: toComputationLog(result.stocks, priceSensitivityPreset),
  })

  // ---- lessonRunTeamState: one write per team that traded this batch ----
  const tradedTeamIds = [...new Set(result.teamAccountUpdates.map((u) => u.teamId))]
  if (tradedTeamIds.length === 0) return

  const [teamAccountSnaps, orderSnaps] = await Promise.all([
    Promise.all(tradedTeamIds.map((teamId) => db.doc(`lessonRuns/${lessonRunId}/teamAccounts/${teamId}`).get())),
    Promise.all(result.orders.map((o) => db.doc(`lessonRuns/${lessonRunId}/orders/${o.orderId}`).get())),
  ])

  const ordersByTeam = new Map<string, MarketOrder[]>()
  orderSnaps.forEach((snap) => {
    if (!snap.exists) return
    const order = snap.data() as MarketOrder
    ordersByTeam.set(order.teamId, [...(ordersByTeam.get(order.teamId) ?? []), order])
  })

  await Promise.all(tradedTeamIds.map(async (teamId, i) => {
    const snap = teamAccountSnaps[i]
    if (!snap.exists) return
    const account = snap.data() as TeamAccount
    await rtdb.ref(`lessonRunTeamState/${lessonRunId}/${teamId}`).update({
      orgId,
      cash: account.cash,
      holdings: account.holdings,
      lockedBuyValue: account.lockedBuyValue,
      lockedSellQuantity: account.lockedSellQuantity,
      myOrders: toMyOrdersView(ordersByTeam.get(teamId) ?? []),
      updatedAtMillis: Date.now(),
    })
  }))
}

/**
 * No-op — see this file's doc comment, item 9: `batchTaskHandler`
 * (`taskHandler.ts`) already calls `enqueueNextBatch` right after
 * `processBatch` returns, so `processBatch` itself must not also enqueue
 * the next batch task.
 */
const scheduleNextBatchNoOp: ProcessBatchDeps['scheduleNextBatch'] = async () => {}

export const processBatchDepsWithAdminSdk = (): ProcessBatchDeps => ({
  readLessonRunState: readLessonRunStateWithAdminSdk,
  listPendingOrders: (lessonRunId, batchId) =>
    listPendingOrdersForBatch({ firestore: ordersRepositoryWithAdminSdk(), lessonRunId, batchId }),
  readTeamAccounts: readTeamAccountsWithAdminSdk,
  listStocksForBatch: listStocksForBatchWithAdminSdk,
  computeInformationImpact: computeInformationImpactWithAdminSdk,
  settleBatchFn: settleBatch,
  commitSettlement: commitSettlementWithAdminSdk,
  appendBatchSettledEvent: appendBatchSettledEventWithAdminSdk,
  publishRealtimeState: publishRealtimeStateWithAdminSdk,
  scheduleNextBatch: scheduleNextBatchNoOp,
  readLifecycleConfig: readLifecycleConfigWithAdminSdk,
  applyLifecycleDividends: applyLifecycleDividendsWithAdminSdk,
  applyLifecycleStockSplits: applyLifecycleStockSplitsWithAdminSdk,
})

/**
 * Wires `processBatch` for real Admin SDK usage, and forwards its
 * lessonRunId/nextBatchIndex to Task 10's `enqueueNextBatch`. Kept
 * separate from `batchTaskHandler`'s own dependency wiring
 * (`taskHandlerDepsWithAdminSdk` in `taskHandler.ts`'s admin wiring, see
 * index.ts) only so `processBatch`'s Admin SDK deps stay independently
 * testable/importable; `enqueueNextBatch` itself is Task 10's, imported
 * here rather than duplicated.
 */
export const processBatchWithAdminSdk = (input: ProcessBatchInput): Promise<void> =>
  processBatch(processBatchDepsWithAdminSdk(), input)

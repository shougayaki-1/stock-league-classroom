import type { MarketOrder } from './orderTypes'
import type { SettleBatchInput, SettleBatchResult } from './engine/settleBatch'

/**
 * `processBatch` is the Admin SDK wrapper around the pure `settleBatch`
 * orchestrator (Task 9). It is the entry point Task 10's Cloud Tasks
 * handler calls once per batch deadline.
 *
 * Per the Task 9 brief's Step 7, THIS FILE FIXES RESPONSIBILITIES AND
 * INTERFACES ONLY — the actual Firestore/RTDB I/O bodies are implemented
 * together with Task 10 (the Cloud Tasks handler that triggers batches
 * and schedules the next one), because they can't be meaningfully tested
 * in isolation from that scheduling loop. `npm run verify`'s pass/fail
 * for this file's *behavior* is deferred to Task 10's completion
 * condition; this task's `verify` only needs the settleBatch/
 * informationImpact pure functions and this file's types to compile and
 * export correctly.
 *
 * The nine steps below (spec §12.9〜§12.11・§12.14・§12.15・§12.20〜§12.22)
 * map 1:1 onto `ProcessBatchDeps`'s methods, in the order `processBatch`
 * must call them:
 *
 * 1. readLessonRunState  — read `lessonRuns/{id}`'s status/randomSeed/
 *    restoreGeneration/socialStudiesMarket. If `status !== 'RUNNING'` or
 *    `marketPaused === true`, processBatch does nothing (Task 11 stop /
 *    Task 10 chain-breaking).
 * 2. listPendingOrders    — Task 5's `listPendingOrdersForBatch`.
 * 3. readTeamAccounts     — Task 7's `TeamAccount` docs, one per team
 *    with orders this batch.
 * 4. computeInformationImpact — per stock, sum each active information
 *    item's `informationImpactPercent` (Task 9's `informationImpact.ts`
 *    window function) plus any published economic indicator's
 *    `companyImpactMultipliers` entry for that company, into the single
 *    `informationImpactPercent` value `settleBatch` expects — no separate
 *    price-calculation term is introduced for indicators. Each stock's
 *    `effectiveMarketSize` is derived from `SimulatedCompany.sizeClass`
 *    via `effectiveMarketSizeForCompany` (Task 3) — there is no path for
 *    a teacher to input share count directly.
 * 5. settleBatch          — call the pure orchestrator (Task 9) with the
 *    data step 1-4 assembled.
 * 6. commitSettlement     — inside a single Firestore transaction (all
 *    reads before all writes, per the Global Constraints transaction
 *    rule — steps 1-4 already did the reads): transition each order's
 *    status via `transitionOrderStatus` (PROCESSING → FILLED/REJECTED),
 *    apply each `TeamAccountUpdate` (releasing the original soft lock via
 *    `releaseSoftLock` before applying the settled delta), and update
 *    each stock's `currentPrice`.
 * 7. appendBatchSettledEvent — record a `BATCH_SETTLED` `LessonEvent`
 *    (batchId, price breakdown, rejection count) via Phase A's
 *    `appendLessonEvent`.
 * 8. publishRealtimeState — update RTDB `lessonRunPublic`/
 *    `lessonRunPrivate`/`lessonRunTeamState` projections (Task 13).
 * 9. scheduleNextBatch    — hand off to Task 10's scheduler for the next
 *    batch.
 */
export interface ProcessBatchDeps {
  readLessonRunState: (lessonRunId: string) => Promise<{
    status: string
    marketPaused?: boolean
    randomSeed: string
    restoreGeneration: number
    // socialStudiesMarket authoring content (companies, price guards, etc.)
    // — shape TBD at Task 10, sourced from Task 1/2's authoring types.
  }>
  listPendingOrders: (lessonRunId: string, batchId: string) => Promise<MarketOrder[]>
  readTeamAccounts: (lessonRunId: string, teamIds: string[]) => Promise<SettleBatchInput['teamAccounts']>
  computeInformationImpact: (lessonRunId: string, batchIndex: number) => Promise<Map<string, number>>
  settleBatchFn: (input: SettleBatchInput) => SettleBatchResult
  commitSettlement: (result: SettleBatchResult, lessonRunId: string, batchId: string) => Promise<void>
  appendBatchSettledEvent: (result: SettleBatchResult, lessonRunId: string, batchId: string) => Promise<void>
  publishRealtimeState: (result: SettleBatchResult, lessonRunId: string) => Promise<void>
  scheduleNextBatch: (lessonRunId: string, batchIndex: number) => Promise<void>
}

export interface ProcessBatchInput {
  lessonRunId: string
  batchId: string
  batchIndex: number
}

/**
 * Not implemented here — see the file-level doc comment. This throws
 * rather than silently no-op-ing so an accidental Task 10 wiring mistake
 * (calling this before its real implementation lands) fails loudly
 * instead of appearing to succeed while doing nothing.
 */
export const processBatch = async (_deps: ProcessBatchDeps, _input: ProcessBatchInput): Promise<void> => {
  throw new Error('processBatch is implemented together with Task 10 (Cloud Tasks handler) — see this file\'s doc comment for the fixed responsibilities/interface.')
}

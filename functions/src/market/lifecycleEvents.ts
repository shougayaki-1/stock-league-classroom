import { getFirestore } from 'firebase-admin/firestore'
import type { PriceGuard } from '@stock-league/market-authoring-content'
import type { TeamAccount } from '../lessonRuns/teamAccounts/types'
import type { StockBatchInput } from './engine/settleBatch'

/**
 * Task 17 (spec §12.28/§12.29/§12.23) — bankruptcy, dividend, and stock
 * split. All three are opt-in via `SocialStudiesMarketContent` flags
 * (Task 2, default `false`/empty) and, when disabled, must have zero effect
 * on the normal batch-settlement flow (`settleBatch`, Task 9, is never
 * modified by this file). This file has two layers:
 *
 * 1. Pure functions (`applyBankruptcy`/`applyDividend`/`applyStockSplit`) —
 *    the per-stock/per-team arithmetic, unit-tested in isolation.
 * 2. Admin SDK wiring that aggregates the pure functions across every team
 *    account / stock doc inside a single Firestore transaction (all reads
 *    before all writes, per this repo's transaction rule), for
 *    `processBatch.ts` (dividend/split, batch-triggered) and
 *    `onCall.ts`'s `triggerBankruptcyCallable` (bankruptcy, teacher
 *    triggered) to call.
 */

export const applyBankruptcy = (_input: { currentPrice: number; priceGuard: PriceGuard }): { newPrice: number; tradingHalted: boolean } => {
  // Deliberately ignores _input.priceGuard (and .currentPrice) — spec
  // §12.23's sole exception: every other price movement in this codebase
  // is clamped by the guard, but a bankrupt company's price legitimately
  // goes to 0. The parameter is kept (unused) so call sites read the same
  // as `applyDividend`/`applyStockSplit` and so a future guard-aware
  // variant doesn't need a signature change.
  return { newPrice: 0, tradingHalted: true }
}

export const applyDividend = (input: { heldShares: number; dividendPerShare: number }): number =>
  input.heldShares * input.dividendPerShare

export const applyStockSplit = (input: { price: number; heldShares: number; splitRatio: number }): { newPrice: number; newHeldShares: number } => ({
  newPrice: input.price / input.splitRatio,
  newHeldShares: input.heldShares * input.splitRatio,
})

// ---------------------------------------------------------------------
// Admin SDK wiring
// ---------------------------------------------------------------------

/**
 * `SocialStudiesMarketContent`'s lifecycle-relevant fields, read back from
 * `lessonRuns/{id}.templateSnapshot.socialStudiesMarket` — the same
 * snapshot `createLessonRun.ts` copies the published template's content
 * into at run-creation time (no separate live-authoring-content doc
 * exists). Every field defaults to the flag-off/empty-array value so a
 * lessonRun whose template predates Task 17 (or omitted these fields)
 * behaves exactly as if all three features were disabled.
 */
export interface LifecycleConfig {
  bankruptcyEnabled: boolean
  dividendEnabled: boolean
  stockSplitEnabled: boolean
  dividendTriggerBatchIndexes: number[]
  stockSplitTriggerBatchIndexes: number[]
  dividendPerShareYen: number
  stockSplitRatio: number
}

export const readLifecycleConfigWithAdminSdk = async (lessonRunId: string): Promise<LifecycleConfig> => {
  const snap = await getFirestore().doc(`lessonRuns/${lessonRunId}`).get()
  const data = (snap.data() ?? {}) as {
    templateSnapshot?: { socialStudiesMarket?: Partial<LifecycleConfig> }
  }
  const config = data.templateSnapshot?.socialStudiesMarket ?? {}
  return {
    bankruptcyEnabled: config.bankruptcyEnabled ?? false,
    dividendEnabled: config.dividendEnabled ?? false,
    stockSplitEnabled: config.stockSplitEnabled ?? false,
    dividendTriggerBatchIndexes: config.dividendTriggerBatchIndexes ?? [],
    stockSplitTriggerBatchIndexes: config.stockSplitTriggerBatchIndexes ?? [],
    dividendPerShareYen: config.dividendPerShareYen ?? 0,
    stockSplitRatio: config.stockSplitRatio ?? 1,
  }
}

/**
 * Pays every team a dividend proportional to its total holdings across all
 * stocks, at a single flat `dividendPerShareYen` (this task's simplifying
 * choice — see task-17-report.md — rather than a per-company amount, which
 * no prior task modeled a field for). Called by `processBatch` only when
 * `dividendEnabled` and the current batchIndex is in
 * `dividendTriggerBatchIndexes` — both checked by the caller, not here.
 */
export const applyLifecycleDividendsWithAdminSdk = async (input: { lessonRunId: string; dividendPerShareYen: number }): Promise<void> => {
  const db = getFirestore()
  await db.runTransaction(async (tx) => {
    // ---- ALL READS FIRST ----
    const teamsSnap = await tx.get(db.collection(`lessonRuns/${input.lessonRunId}/teamAccounts`))

    // ---- ALL WRITES AFTER ----
    teamsSnap.docs.forEach((doc) => {
      const account = doc.data() as TeamAccount
      const totalDividend = Object.values(account.holdings).reduce(
        (sum, heldShares) => sum + applyDividend({ heldShares, dividendPerShare: input.dividendPerShareYen }),
        0,
      )
      if (totalDividend === 0) return
      tx.update(doc.ref, { cash: account.cash + totalDividend, updatedAtServerMillis: Date.now() })
    })
  })
}

/**
 * Splits every stock's current price and every team's holdings of it by a
 * single flat `splitRatio` (same simplifying choice as dividends above).
 * Called by `processBatch` only when `stockSplitEnabled` and the current
 * batchIndex is in `stockSplitTriggerBatchIndexes`.
 */
export const applyLifecycleStockSplitsWithAdminSdk = async (input: { lessonRunId: string; splitRatio: number }): Promise<void> => {
  const db = getFirestore()
  await db.runTransaction(async (tx) => {
    // ---- ALL READS FIRST ----
    const stocksSnap = await tx.get(db.collection(`lessonRuns/${input.lessonRunId}/stocks`))
    const teamsSnap = await tx.get(db.collection(`lessonRuns/${input.lessonRunId}/teamAccounts`))

    // ---- ALL WRITES AFTER ----
    stocksSnap.docs.forEach((doc) => {
      const stock = doc.data() as StockBatchInput
      const { newPrice } = applyStockSplit({ price: stock.currentPrice, heldShares: 0, splitRatio: input.splitRatio })
      tx.update(doc.ref, { currentPrice: newPrice, updatedAtServerMillis: Date.now() })
    })
    teamsSnap.docs.forEach((doc) => {
      const account = doc.data() as TeamAccount
      const holdings = Object.fromEntries(
        Object.entries(account.holdings).map(([stockId, heldShares]) => [
          stockId,
          applyStockSplit({ price: 0, heldShares, splitRatio: input.splitRatio }).newHeldShares,
        ]),
      )
      tx.update(doc.ref, { holdings, updatedAtServerMillis: Date.now() })
    })
  })
}

/**
 * Teacher-triggered bankruptcy for a single stock (spec §12.23/§12.28) —
 * unlike dividend/split, this is never invoked from `processBatch`'s
 * batch-index-triggered flow: bankruptcy is an explicit one-off teacher
 * action (`triggerBankruptcyCallable`, `onCall.ts`), so the normal batch
 * flow is unaffected whether `bankruptcyEnabled` is true or false. Halts
 * trading by leaving the stock's price at 0 and relying on `settleBatch`'s
 * existing `tradingHalted`/guard machinery (Task 1/9) to reject further
 * orders — this function only owns the single price/halt write.
 */
export const triggerBankruptcyWithAdminSdk = async (input: { lessonRunId: string; stockId: string }): Promise<void> => {
  const db = getFirestore()
  const stockRef = db.doc(`lessonRuns/${input.lessonRunId}/stocks/${input.stockId}`)
  await db.runTransaction(async (tx) => {
    // ---- ALL READS FIRST ----
    const stockSnap = await tx.get(stockRef)
    if (!stockSnap.exists) throw new Error('銘柄が見つかりません。')
    const stock = stockSnap.data() as StockBatchInput

    // ---- ALL WRITES AFTER ----
    const result = applyBankruptcy({ currentPrice: stock.currentPrice, priceGuard: stock.priceGuard })
    tx.update(stockRef, { currentPrice: result.newPrice, tradingHalted: result.tradingHalted, updatedAtServerMillis: Date.now() })
  })
}

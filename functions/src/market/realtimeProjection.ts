import type { MarketOrder } from './orderTypes'
import type { StockSettlementResult } from './engine/settleBatch'

/**
 * Server-side counterpart of src/lib/lessonRuns/liveTypes.ts's
 * `PriceBreakdownPublicView` (functions cannot import across the
 * functions/src rootDir boundary — see functions/src/lessonRuns/
 * projections/publicProjection.ts's JSDoc for the established precedent).
 * Keep both in sync by hand.
 */
export interface PriceBreakdownPublicView {
  informationPercent: number
  demandPercent: number
  otherPercent: number
  total: number
}

/**
 * Server-side counterpart of src/lib/lessonRuns/liveTypes.ts's
 * `StockPublicState`. SECURITY-CRITICAL (spec §26-1): built by allow-list
 * only — `toStockPublicStates` below must never spread a
 * `StockSettlementResult`, which carries no secrets itself but sits next
 * to code that does (netDemandValue is intentionally excluded here; only
 * `displayedVolumeShares`, the gross pre-netting figure, is public per
 * contradiction-resolution C).
 */
export interface StockPublicState {
  currentPrice: number
  previousPrice: number
  guardApplied: boolean
  suddenChangeWarning: boolean
  breakdown: PriceBreakdownPublicView
  displayedVolumeShares: number
}

/**
 * Projects this batch's `StockSettlementResult[]` (Task 9's `settleBatch`
 * output) down to the participant-broadcast-safe `stocks` map for
 * `lessonRunPublic/{lessonRunId}`.
 *
 * `previousPrice` is this batch's `executionPrice` — the price orders
 * actually filled at, which becomes "the previous price" from the
 * perspective of the NEXT batch (per this task's brief). `currentPrice` is
 * `nextPrice`, the price this batch just moved to.
 *
 * Allow-list only: `netDemandValue` (would let a participant back out
 * hard-to-observe order flow) and any internal coefficient are
 * deliberately not read from `StockSettlementResult` here.
 */
export const toStockPublicStates = (stocks: StockSettlementResult[]): Record<string, StockPublicState> => {
  const out: Record<string, StockPublicState> = {}
  for (const stock of stocks) {
    out[stock.stockId] = {
      currentPrice: stock.nextPrice,
      previousPrice: stock.executionPrice,
      guardApplied: stock.guardApplied,
      suddenChangeWarning: stock.suddenChangeWarning,
      breakdown: {
        informationPercent: stock.breakdown.informationPercent,
        demandPercent: stock.breakdown.demandPercent,
        otherPercent: stock.breakdown.otherPercent,
        total: stock.breakdown.total,
      },
      displayedVolumeShares: stock.displayedVolumeShares,
    }
  }
  return out
}

/**
 * Server-side counterpart of one entry in src/lib/lessonRuns/
 * liveTypes.ts's `LessonRunPrivateState.computationLog` — the
 * teacher-only full computation log (spec §12.31), INCLUDING the internal
 * coefficient `StockPublicState` deliberately omits (the active
 * `priceSensitivityPreset`). Never sent to `lessonRunPublic`.
 */
export interface ComputationLogEntry {
  informationImpactPercent: number
  demandImpactPercent: number
  noisePercent: number
  priceSensitivityPreset: string
}

/**
 * Builds the teacher-only `computationLog` for `lessonRunPrivate/
 * {lessonRunId}`. `StockSettlementResult.breakdown` itself only carries
 * the four participant-shaped percentages (Task 3's design — no internal
 * coefficients live on `breakdown`), so the one coefficient the teacher log
 * adds beyond the public breakdown — `priceSensitivityPreset` — is passed
 * in separately from the lessonRun's own state, not read off `breakdown`.
 */
export const toComputationLog = (
  stocks: StockSettlementResult[],
  priceSensitivityPreset: string,
): Record<string, ComputationLogEntry> => {
  const out: Record<string, ComputationLogEntry> = {}
  for (const stock of stocks) {
    out[stock.stockId] = {
      informationImpactPercent: stock.breakdown.informationPercent,
      demandImpactPercent: stock.breakdown.demandPercent,
      noisePercent: stock.breakdown.otherPercent,
      priceSensitivityPreset,
    }
  }
  return out
}

/** Server-side counterpart of src/lib/lessonRuns/liveTypes.ts's `MyOrderView`. */
export interface MyOrderView {
  orderId: string
  stockId: string
  side: 'BUY' | 'SELL'
  quantity: number
  status: MarketOrder['status']
  referencePrice: number
  executionPrice?: number
}

/**
 * Projects a single team's own `MarketOrder` docs down to the
 * `lessonRunTeamState/{lessonRunId}/{teamId}.myOrders` shape. Callers MUST
 * pre-filter `orders` to a single team — this function does not check
 * `teamId` itself, so passing another team's orders in would leak them
 * (see `lessonRunTeamState`'s one-team-per-node isolation, this file's
 * `toComputationLog`/`toStockPublicStates` JSDoc for the same allow-list
 * discipline applied here).
 */
export const toMyOrdersView = (orders: MarketOrder[]): MyOrderView[] =>
  orders.map((order) => ({
    orderId: order.orderId,
    stockId: order.stockId,
    side: order.side,
    quantity: order.quantity,
    status: order.status,
    referencePrice: order.referencePrice,
    ...(order.executionPrice !== undefined ? { executionPrice: order.executionPrice } : {}),
  }))

import type { PriceGuard } from '@stock-league/market-authoring-content'
import { aggregateDemand, nettedFillForParticipant, type NettedFill, type OrderForNetting } from './demandAggregation'
import { hardCheckBuyOrders, hardCheckSellOrdersForStock } from './fundLocking'
import { calculateNextPrice, type PriceSensitivityPreset } from './priceCalculation'

export interface StockBatchInput {
  stockId: string
  currentPrice: number
  initialPrice: number
  priceGuard: PriceGuard
  effectiveMarketSize: number
  demandSensitivity: number
  /** Pre-aggregated across active information items for this stock this batch. */
  informationImpactPercent: number
}

export interface OrderForSettlement {
  orderId: string
  teamId: string
  stockId: string
  side: 'BUY' | 'SELL'
  quantity: number
  referencePrice: number
}

export interface TeamAccountForSettlement {
  teamId: string
  /** Cash BEFORE this batch — must not include this batch's own sell proceeds (spec §12.15). */
  cash: number
  holdings: Record<string, number>
}

export interface SettleBatchInput {
  lessonRunId: string
  batchId: string
  batchIndex: number
  randomSeed: string
  restoreGeneration: number
  priceSensitivityPreset: PriceSensitivityPreset
  noiseEnabled: boolean
  stocks: StockBatchInput[]
  orders: OrderForSettlement[]
  teamAccounts: TeamAccountForSettlement[]
}

export interface OrderSettlementOutcome {
  orderId: string
  status: 'FILLED' | 'REJECTED'
  executionPrice?: number
  rejectionReason?: string
}

export interface StockSettlementResult {
  stockId: string
  executionPrice: number
  nextPrice: number
  breakdown: ReturnType<typeof calculateNextPrice>['breakdown']
  guardApplied: boolean
  suddenChangeWarning: boolean
  displayedVolumeShares: number
  netDemandValue: number
}

export interface TeamAccountUpdate {
  teamId: string
  cashDelta: number
  holdingsDelta: Record<string, number>
}

export interface SettleBatchResult {
  orders: OrderSettlementOutcome[]
  stocks: StockSettlementResult[]
  teamAccountUpdates: TeamAccountUpdate[]
}

const groupKey = (teamId: string, stockId: string) => `${teamId}::${stockId}`

export const settleBatch = (input: SettleBatchInput): SettleBatchResult => {
  const stocksById = new Map(input.stocks.map((s) => [s.stockId, s]))
  const accountsByTeam = new Map(input.teamAccounts.map((a) => [a.teamId, a]))

  const ordersByGroup = new Map<string, OrderForSettlement[]>()
  for (const order of input.orders) {
    const key = groupKey(order.teamId, order.stockId)
    ordersByGroup.set(key, [...(ordersByGroup.get(key) ?? []), order])
  }

  const nettedByGroup = new Map<string, NettedFill | null>()
  for (const [key, orders] of ordersByGroup) {
    nettedByGroup.set(key, nettedFillForParticipant(orders as OrderForNetting[]))
  }

  // Hard BUY check: aggregate a team's net-buy groups across ALL stocks.
  const buyFailedTeams = new Set<string>()
  for (const account of input.teamAccounts) {
    const buyOrders = input.stocks
      .map((stock) => ({ stockId: stock.stockId, netted: nettedByGroup.get(groupKey(account.teamId, stock.stockId)) }))
      .filter((x): x is { stockId: string; netted: NettedFill } => x.netted !== null && x.netted !== undefined && x.netted.side === 'BUY')
      .map((x) => ({ stockId: x.stockId, quantity: x.netted.quantity, executionPrice: stocksById.get(x.stockId)!.currentPrice }))
    if (buyOrders.length === 0) continue
    const result = hardCheckBuyOrders({ cashBeforeBatch: account.cash, buyOrders })
    if (!result.allSucceed) buyFailedTeams.add(account.teamId)
  }

  // Hard SELL check: per (team, stock) independently.
  const sellFailedGroups = new Set<string>()
  for (const [key, netted] of nettedByGroup) {
    if (!netted || netted.side !== 'SELL') continue
    const [teamId, stockId] = key.split('::')
    const held = accountsByTeam.get(teamId)?.holdings[stockId] ?? 0
    const result = hardCheckSellOrdersForStock({ heldShares: held, sellOrders: [{ stockId, quantity: netted.quantity }] })
    if (!result.allSucceed) sellFailedGroups.add(key)
  }

  const groupSucceeded = (teamId: string, stockId: string): boolean => {
    const netted = nettedByGroup.get(groupKey(teamId, stockId))
    if (!netted) return false // fully netted to zero — no trade, not a "success" for volume/demand purposes
    if (netted.side === 'BUY') return !buyFailedTeams.has(teamId)
    return !sellFailedGroups.has(groupKey(teamId, stockId))
  }

  // Order outcomes: every original order is FILLED unless its group hard-failed.
  const orderOutcomes: OrderSettlementOutcome[] = input.orders.map((order) => {
    const netted = nettedByGroup.get(groupKey(order.teamId, order.stockId))
    const executionPrice = stocksById.get(order.stockId)!.currentPrice
    if (!netted) return { orderId: order.orderId, status: 'FILLED', executionPrice } // netted to zero — no-op, not a failure
    const failed = netted.side === 'BUY' ? buyFailedTeams.has(order.teamId) : sellFailedGroups.has(groupKey(order.teamId, order.stockId))
    if (failed) {
      const reason = netted.side === 'BUY'
        ? 'このチームの現金が不足したため、この区間の買い注文はすべて不成立になりました。'
        : '保有株数が不足したため、この銘柄の売り注文はすべて不成立になりました。'
      return { orderId: order.orderId, status: 'REJECTED', rejectionReason: reason }
    }
    return { orderId: order.orderId, status: 'FILLED', executionPrice }
  })

  // Team account updates: only from successful netted groups.
  const teamAccountUpdates: TeamAccountUpdate[] = []
  for (const [key, netted] of nettedByGroup) {
    if (!netted) continue
    const [teamId, stockId] = key.split('::')
    if (!groupSucceeded(teamId, stockId)) continue
    const price = stocksById.get(stockId)!.currentPrice
    if (netted.side === 'BUY') {
      teamAccountUpdates.push({ teamId, cashDelta: -netted.quantity * price, holdingsDelta: { [stockId]: netted.quantity } })
    } else {
      teamAccountUpdates.push({ teamId, cashDelta: netted.quantity * price, holdingsDelta: { [stockId]: -netted.quantity } })
    }
  }

  // Per-stock price calculation from only the successful groups.
  const stockResults: StockSettlementResult[] = input.stocks.map((stock) => {
    const successfulFills: NettedFill[] = []
    const grossOrders: OrderForNetting[] = []
    for (const [key, netted] of nettedByGroup) {
      const [teamId, stockIdOfGroup] = key.split('::')
      if (stockIdOfGroup !== stock.stockId || !netted) continue
      if (!groupSucceeded(teamId, stockIdOfGroup)) continue
      successfulFills.push(netted)
      grossOrders.push(...(ordersByGroup.get(key) ?? []))
    }
    const demand = aggregateDemand({ executionPrice: stock.currentPrice, nettedFills: successfulFills, rawOrders: grossOrders })
    const priceResult = calculateNextPrice({
      currentPrice: stock.currentPrice, initialPrice: stock.initialPrice,
      informationImpactPercent: stock.informationImpactPercent, netDemandValue: demand.netDemandValue,
      effectiveMarketSize: stock.effectiveMarketSize, demandSensitivity: stock.demandSensitivity,
      priceSensitivityPreset: input.priceSensitivityPreset, noiseEnabled: input.noiseEnabled,
      randomSeed: input.randomSeed, restoreGeneration: input.restoreGeneration,
      stockId: stock.stockId, batchIndex: input.batchIndex, priceGuard: stock.priceGuard,
    })
    return {
      stockId: stock.stockId, executionPrice: stock.currentPrice, nextPrice: priceResult.nextPrice,
      breakdown: priceResult.breakdown, guardApplied: priceResult.guardApplied,
      suddenChangeWarning: priceResult.suddenChangeWarning,
      displayedVolumeShares: demand.displayedVolumeShares, netDemandValue: demand.netDemandValue,
    }
  })

  return { orders: orderOutcomes, stocks: stockResults, teamAccountUpdates }
}

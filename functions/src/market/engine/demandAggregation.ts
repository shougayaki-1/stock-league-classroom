export interface OrderForNetting {
  side: 'BUY' | 'SELL'
  quantity: number
}

export interface NettedFill {
  side: 'BUY' | 'SELL'
  quantity: number
}

/** Spec §12.14: nets one participant's same-stock, same-batch buy/sell orders. */
export const nettedFillForParticipant = (orders: OrderForNetting[]): NettedFill | null => {
  const buyQuantity = orders.filter((o) => o.side === 'BUY').reduce((sum, o) => sum + o.quantity, 0)
  const sellQuantity = orders.filter((o) => o.side === 'SELL').reduce((sum, o) => sum + o.quantity, 0)
  const diff = buyQuantity - sellQuantity
  if (diff === 0) return null
  return diff > 0 ? { side: 'BUY', quantity: diff } : { side: 'SELL', quantity: -diff }
}

export interface DemandAggregationInput {
  /** The price in effect for this batch — all fills in a batch settle at
   * the same price (spec §12.10), so this is a single number, not a list. */
  executionPrice: number
  /** One entry per participant, ALREADY netted via nettedFillForParticipant. */
  nettedFills: NettedFill[]
  /** Every order as originally submitted, BEFORE per-participant netting. */
  rawOrders: OrderForNetting[]
}

export interface DemandAggregationResult {
  /** Signed yen value. Positive = net buying pressure. Feeds
   * priceCalculation.ts's `netDemandValue` (Task 3). */
  netDemandValue: number
  /** Gross shares traded, pre-netting. Display-only — spec §12.5's
   * "出来高相当の売買量" and 矛盾解消C's displayedVolume. */
  displayedVolumeShares: number
}

/**
 * Spec resolution C: demand pressure must come from the NET (post-netting)
 * value of each participant's fills, never the GROSS pre-netting quantity.
 * A participant submitting 100 buy + 98 sell in the same batch nets to a
 * 2-share buy for demand purposes — even though displayedVolumeShares still
 * reports the full 198 gross shares traded. Mixing these two numbers into a
 * single return value would let a participant tie up capital for only the
 * net 2 shares while exerting 100-share price pressure; keeping them as
 * separate, distinctly-named fields makes that confusion impossible for
 * callers to introduce by accident.
 */
export const aggregateDemand = (input: DemandAggregationInput): DemandAggregationResult => {
  let netBuyValue = 0
  let netSellValue = 0
  for (const fill of input.nettedFills) {
    const value = fill.quantity * input.executionPrice
    if (fill.side === 'BUY') netBuyValue += value
    else netSellValue += value
  }
  const displayedVolumeShares = input.rawOrders.reduce((sum, o) => sum + o.quantity, 0)
  return { netDemandValue: netBuyValue - netSellValue, displayedVolumeShares }
}

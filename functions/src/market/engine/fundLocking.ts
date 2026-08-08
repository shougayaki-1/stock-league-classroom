/** Spec §12.16 display: "利用可能現金 = 現金 − 拘束中の買い注文額（参考価格ベース）". */
export const computeAvailableCash = (cash: number, lockedBuyValueAtReferencePrice: number): number =>
  cash - lockedBuyValueAtReferencePrice

/** Spec §12.16 display: "追加売却可能 = 保有 − 売却注文中". */
export const computeAvailableShares = (heldShares: number, lockedSellQuantity: number): number =>
  heldShares - lockedSellQuantity

export interface BuyOrderForSettlement {
  stockId: string
  quantity: number
  executionPrice: number
}

export interface HardBuyCheckInput {
  /** Cash balance BEFORE this batch's fills — must NOT include proceeds
   * from this same batch's sell orders (spec §12.15). */
  cashBeforeBatch: number
  buyOrders: BuyOrderForSettlement[]
}

export interface HardCheckResult {
  allSucceed: boolean
  totalCost: number
}

/**
 * Hard (settlement-time) check for BUY orders. Spec §12.15 asymmetry:
 * cash is shared across ALL stocks, so all BUY orders in the batch —
 * regardless of which stock they target — are summed against a single
 * cash balance and either all succeed or all fail together.
 *
 * `cashBeforeBatch` must be the cash balance at the START of this batch's
 * settlement interval — it must NOT include proceeds from this same
 * batch's own sell orders (spec §12.15 "同一区間で得る売却代金は、その区間の購入には使えない").
 * The caller (Task 9's settleBatch) is responsible for passing the
 * pre-batch balance.
 */
export const hardCheckBuyOrders = (input: HardBuyCheckInput): HardCheckResult => {
  const totalCost = input.buyOrders.reduce((sum, o) => sum + o.quantity * o.executionPrice, 0)
  return { allSucceed: totalCost <= input.cashBeforeBatch, totalCost }
}

export interface SellOrderForSettlement {
  stockId: string
  quantity: number
}

export interface HardSellCheckInput {
  heldShares: number
  /** Must already be filtered to a single stockId by the caller (Task 9) —
   * shares of different stocks are not fungible, unlike cash. */
  sellOrders: SellOrderForSettlement[]
}

export interface HardSellCheckResult {
  allSucceed: boolean
  totalQuantity: number
}

/**
 * Hard (settlement-time) check for SELL orders of ONE stock. Spec §12.15
 * asymmetry: shares of different stocks are not fungible, so this must be
 * called once PER STOCK by the caller, each time scoped to that stock's
 * held shares and that stock's sell orders only — a shortfall in one
 * stock must never cause a different stock's sell orders to fail.
 */
export const hardCheckSellOrdersForStock = (input: HardSellCheckInput): HardSellCheckResult => {
  const totalQuantity = input.sellOrders.reduce((sum, o) => sum + o.quantity, 0)
  return { allSucceed: totalQuantity <= input.heldShares, totalQuantity }
}

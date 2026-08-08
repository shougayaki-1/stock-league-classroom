export interface TeamAccount {
  teamId: string
  lessonRunId: string
  cash: number
  /** stockId → quantity held. */
  holdings: Record<string, number>
  /** Sum of PENDING/PROCESSING buy orders at reference price, across all
   * stocks — spec §12.16's "注文中資金" (soft lock, cash is fungible). */
  lockedBuyValue: number
  /** stockId → quantity locked by PENDING/PROCESSING sell orders of that
   * stock — shares are not fungible across stocks, unlike cash. */
  lockedSellQuantity: Record<string, number>
  updatedAtServerMillis: number
}

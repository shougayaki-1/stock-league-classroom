import { describe, expect, it } from 'vitest'
import {
  computeAvailableCash,
  computeAvailableShares,
  hardCheckBuyOrders,
  hardCheckSellOrdersForStock,
} from './fundLocking'

describe('computeAvailableCash', () => {
  it('matches the spec §12.16 display example: 20,000 cash - 6,000 locked = 14,000 available', () => {
    expect(computeAvailableCash(20000, 6000)).toBe(14000)
  })
})

describe('computeAvailableShares', () => {
  it('matches the spec §12.16 display example: 10 held - 4 locked = 6 available', () => {
    expect(computeAvailableShares(10, 4)).toBe(6)
  })
})

describe('hardCheckBuyOrders', () => {
  it('sums BUY orders ACROSS ALL STOCKS against a single cash balance (spec §12.15 "複数銘柄を含む買い注文合計を一括判定する")', () => {
    const result = hardCheckBuyOrders({
      cashBeforeBatch: 10000,
      buyOrders: [
        { stockId: 'acme', quantity: 3, executionPrice: 1000 }, // 3,000
        { stockId: 'globex', quantity: 5, executionPrice: 1500 }, // 7,500
      ],
    })
    expect(result.totalCost).toBe(10500)
    expect(result.allSucceed).toBe(false) // 10,500 > 10,000 cash — ALL buy orders (both stocks) fail
  })

  it('excludes this batch\'s own sell proceeds from the cash basis (spec §12.15 "同一区間で得る売却代金は、その区間の購入には使えない")', () => {
    // cashBeforeBatch already reflects "no same-batch sell proceeds" —
    // this test documents that the caller (Task 9) must pass the
    // pre-batch balance, not balance-after-applying-this-batch's-sells.
    const result = hardCheckBuyOrders({
      cashBeforeBatch: 3000, // caller did NOT add this batch's sell proceeds here
      buyOrders: [{ stockId: 'acme', quantity: 3, executionPrice: 1000 }],
    })
    expect(result.allSucceed).toBe(true)
    expect(result.totalCost).toBe(3000)
  })
})

describe('hardCheckSellOrdersForStock', () => {
  it('checks SELL orders PER STOCK against that stock\'s held shares only (spec §12.15 "その区間の当該売り注文をすべて不成立")', () => {
    const result = hardCheckSellOrdersForStock({
      heldShares: 5,
      sellOrders: [{ stockId: 'acme', quantity: 3 }, { stockId: 'acme', quantity: 4 }],
    })
    expect(result.totalQuantity).toBe(7)
    expect(result.allSucceed).toBe(false) // 7 > 5 held shares of THIS stock
  })

  it('does not let a shortfall in one stock affect a different stock\'s sell check (caller must call this once per stock)', () => {
    const acmeResult = hardCheckSellOrdersForStock({ heldShares: 2, sellOrders: [{ stockId: 'acme', quantity: 5 }] })
    const globexResult = hardCheckSellOrdersForStock({ heldShares: 10, sellOrders: [{ stockId: 'globex', quantity: 5 }] })
    expect(acmeResult.allSucceed).toBe(false)
    expect(globexResult.allSucceed).toBe(true)
  })
})
